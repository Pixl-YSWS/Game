import { loadSettings } from "../data/Settings";

// Toggle (open-mic) voice chat. While the mic is ON, it continuously records
// short self-contained audio segments and streams them to the server, which
// relays each chunk to everyone else in the same world. Receivers queue a
// speaker's chunks and play them back-to-back for near-continuous voice.
//
// Why fixed self-contained segments instead of one MediaRecorder timeslice
// stream: WebM/Opus timeslice chunks after the first lack a header and can't be
// decoded on their own (you'd need MediaSource Extensions, which Safari barely
// supports for Opus). Re-recording a fresh ~1.5s clip each cycle keeps every
// chunk independently playable with a plain <audio>, cross-browser.

function pickMime(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  if (typeof MediaRecorder === "undefined") return "";
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return "";
}

class VoiceChat {
  private stream?: MediaStream;
  private recorder?: MediaRecorder;
  private enabled = false;
  private segTimer?: ReturnType<typeof setTimeout>;
  private sender?: (data: ArrayBuffer, mime: string) => void;
  private stateCb?: (on: boolean) => void;

  // ── Playback (Web Audio) ──────────────────────────────────────────────
  // Each speaker's clips are decoded and scheduled back-to-back on a single
  // AudioContext timeline so they play sample-accurately with NO gap between
  // chunks. Bare <audio> elements (the old approach) re-prime the decoder on
  // every clip, leaving a silent seam ~every segment — which made continuous
  // speech come through as choppy fragments.
  private ctx?: AudioContext;
  private gain?: GainNode;
  private comp?: DynamicsCompressorNode;
  // Per-speaker scheduling cursor: the AudioContext time the next clip should
  // start at (= when the previous one ends).
  private nextTime = new Map<string, number>();
  // Boost incoming voice a little; a compressor after it tames any clipping so
  // the gain makes things audibly louder without distorting loud speech.
  private static readonly GAIN = 1.7;
  // Cushion added when (re)starting a speaker, so the first clip doesn't
  // underrun before the next arrives.
  private static readonly JITTER_S = 0.12;

  // Length of each streamed segment. This is the dominant source of latency
  // (a whole segment must be recorded before it can be sent), so keep it short.
  // Too short adds per-segment overhead and audible seams; ~0.7s is a good
  // low-latency balance for a casual game.
  private static readonly SEGMENT_MS = 700;

  /** True if the browser can record audio at all (used to hide the mic UI). */
  get supported(): boolean {
    return (
      typeof MediaRecorder !== "undefined" &&
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia
    );
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Where recorded chunks are sent (wired to gameSocket.sendVoiceClip). */
  setSender(fn: (data: ArrayBuffer, mime: string) => void) {
    this.sender = fn;
  }

  /** Notified whenever the mic turns on/off (incl. auto-off on error) so the
   *  HUD button can reflect the real state. */
  onStateChange(fn: (on: boolean) => void) {
    this.stateCb = fn;
  }

  // Lazily request the mic. Resolves false if denied / unavailable.
  private async ensureMic(): Promise<boolean> {
    if (this.stream) return true;
    if (!this.supported) return false;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      return true;
    } catch {
      return false;
    }
  }

  // Turn the mic on and start streaming. Returns false if voice is disabled in
  // settings, unsupported, or the mic was denied.
  async enable(): Promise<boolean> {
    if (this.enabled) return true;
    if (!loadSettings().voiceEnabled) return false;
    if (!(await this.ensureMic())) return false;
    this.enabled = true;
    // Warm up / resume the playback graph on this user gesture so received
    // voice can play without waiting for a later interaction.
    this.ensureCtx();
    this.recordSegment();
    this.stateCb?.(true);
    return true;
  }

  // Turn the mic off and release it (clears the browser's recording indicator).
  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.segTimer) clearTimeout(this.segTimer);
    this.segTimer = undefined;
    try {
      this.recorder?.stop();
    } catch {
      /* already stopped */
    }
    this.recorder = undefined;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    this.stateCb?.(false);
  }

  /** Flip the mic on/off. Returns the new state. */
  async toggle(): Promise<boolean> {
    if (this.enabled) {
      this.disable();
      return false;
    }
    return this.enable();
  }

  // Record one segment; on stop, ship it. The next segment's recorder is
  // started *before* this one stops (see the timer below) so the mic is never
  // left un-captured at a boundary — the old code recreated the recorder inside
  // the async onstop, leaving a gap that clipped a slice of speech every cycle.
  private recordSegment() {
    // Auto-stop if voice got turned off in settings while the mic was live.
    if (!this.enabled || !this.stream || !loadSettings().voiceEnabled) {
      this.disable();
      return;
    }
    // Per-segment local state so overlapping recorders never clobber each
    // other's buffered chunks (the old shared this.chunks/this.mime were a
    // race waiting to happen once segments can briefly coexist).
    const mime = pickMime();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    } catch {
      this.disable();
      return;
    }
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => void this.flush(chunks, mime);
    recorder.start();
    this.recorder = recorder;
    this.segTimer = setTimeout(() => {
      // Start the next recorder first, then stop this one. The two briefly
      // overlap on the same stream — a few ms of duplicated audio is far less
      // noticeable than the dropped audio a stop→recreate gap produced.
      if (this.enabled) this.recordSegment();
      try {
        recorder.stop();
      } catch {
        /* ignore */
      }
    }, VoiceChat.SEGMENT_MS);
  }

  private async flush(chunks: Blob[], mime: string) {
    const blob = new Blob(chunks, { type: mime || "audio/webm" });
    // Drop near-silent blips and anything implausibly large (server caps too).
    if (blob.size < 1200 || blob.size > 800_000) return;
    try {
      const buf = await blob.arrayBuffer();
      this.sender?.(buf, blob.type || "audio/webm");
    } catch {
      /* ignore */
    }
  }

  // Lazily build the shared playback graph: gain → compressor → output. The
  // context starts suspended until a user gesture; we resume it opportunistically
  // (toggling the mic, or any received clip after the player has interacted).
  private ensureCtx(): AudioContext | undefined {
    const Ctor =
      (typeof AudioContext !== "undefined" && AudioContext) ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return undefined;
    if (!this.ctx) {
      this.ctx = new Ctor();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = VoiceChat.GAIN;
      this.comp = this.ctx.createDynamicsCompressor();
      this.gain.connect(this.comp);
      this.comp.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  // Decode a received clip from speaker `id` and schedule it to play exactly
  // when their previous clip ends — gapless, sample-accurate. Falling behind
  // (a network stall) just restarts the cursor near "now".
  async play(id: string, data: ArrayBuffer, _mime: string) {
    if (!loadSettings().voiceEnabled) return;
    const ctx = this.ensureCtx();
    if (!ctx || !this.gain) return;
    // socket.io delivers browser binary as an ArrayBuffer, but normalise a
    // TypedArray view too. decodeAudioData detaches its input, so hand it a
    // fresh copy (each segment is a self-contained webm/mp4 clip).
    const ab = ArrayBuffer.isView(data)
      ? ((data as ArrayBufferView).buffer as ArrayBuffer).slice(0)
      : (data as ArrayBuffer).slice(0);
    let buffer: AudioBuffer;
    try {
      buffer = await ctx.decodeAudioData(ab);
    } catch {
      return; // undecodable chunk — skip it rather than break the stream
    }
    const now = ctx.currentTime;
    let start = this.nextTime.get(id) ?? 0;
    // First clip, or we've drained below real-time: (re)start with a small
    // cushion so the next clip has time to arrive before this one ends.
    if (start < now + 0.02) start = now + VoiceChat.JITTER_S;
    // Don't let the schedule run away if clips arrive in a burst.
    if (start > now + 1.0) start = now + 1.0;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.gain);
    src.start(start);
    this.nextTime.set(id, start + buffer.duration);
  }

  // Tear everything down (mic + playback graph) when leaving gameplay.
  release() {
    this.disable();
    this.nextTime.clear();
    try {
      void this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.ctx = undefined;
    this.gain = undefined;
    this.comp = undefined;
  }
}

export const voiceChat = new VoiceChat();
