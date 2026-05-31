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

interface PlayQueue {
  urls: string[];
  playing: boolean;
}

class VoiceChat {
  private stream?: MediaStream;
  private recorder?: MediaRecorder;
  private enabled = false;
  private segTimer?: ReturnType<typeof setTimeout>;
  private sender?: (data: ArrayBuffer, mime: string) => void;
  private stateCb?: (on: boolean) => void;
  // Per-speaker playback queues so one person's chunks play in order without
  // overlapping (different speakers still play concurrently).
  private queues = new Map<string, PlayQueue>();

  // Length of each streamed segment. This is the dominant source of latency
  // (a whole segment must be recorded before it can be sent), so keep it short.
  // Too short adds per-segment overhead and audible seams; ~0.7s is a good
  // low-latency balance for a casual game.
  private static readonly SEGMENT_MS = 700;
  // Small jitter buffer: up to this many chunks may wait behind the one
  // currently playing. A buffer of 1 (the old value) dropped audio at the
  // slightest network hiccup, which is the main cause of choppy voice; 2 rides
  // out normal jitter while still capping how far behind real-time we drift.
  private static readonly MAX_QUEUE = 2;

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

  // Queue a received chunk from speaker `id` and play it after their earlier
  // ones (unless the listener has voice muted).
  play(id: string, data: ArrayBuffer, mime: string) {
    if (!loadSettings().voiceEnabled) return;
    let q = this.queues.get(id);
    if (!q) {
      q = { urls: [], playing: false };
      this.queues.set(id, q);
    }
    try {
      const url = URL.createObjectURL(new Blob([data], { type: mime || "audio/webm" }));
      q.urls.push(url);
      // If we're falling behind, drop the oldest queued chunks to catch up.
      while (q.urls.length > VoiceChat.MAX_QUEUE) {
        const stale = q.urls.shift()!;
        URL.revokeObjectURL(stale);
      }
      if (!q.playing) this.playNext(id);
    } catch {
      /* ignore */
    }
  }

  private playNext(id: string) {
    const q = this.queues.get(id);
    if (!q) return;
    const url = q.urls.shift();
    if (!url) {
      q.playing = false;
      return;
    }
    q.playing = true;
    const audio = new Audio(url);
    const next = () => {
      URL.revokeObjectURL(url);
      this.playNext(id);
    };
    audio.onended = next;
    audio.onerror = next;
    audio.play().catch(next);
  }

  // Tear everything down (mic + any queued playback) when leaving gameplay.
  release() {
    this.disable();
    for (const q of this.queues.values()) {
      for (const url of q.urls) URL.revokeObjectURL(url);
    }
    this.queues.clear();
  }
}

export const voiceChat = new VoiceChat();
