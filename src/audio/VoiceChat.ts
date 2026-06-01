import { loadSettings } from "../data/Settings";

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

  private ctx?: AudioContext;
  private gain?: GainNode;
  private comp?: DynamicsCompressorNode;

  private nextTime = new Map<string, number>();

  private static readonly GAIN = 1.7;

  private static readonly JITTER_S = 0.12;

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

  async enable(): Promise<boolean> {
    if (this.enabled) return true;
    if (!loadSettings().voiceEnabled) return false;
    if (!(await this.ensureMic())) return false;
    this.enabled = true;

    this.ensureCtx();
    this.recordSegment();
    this.stateCb?.(true);
    return true;
  }

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

  private recordSegment() {
    if (!this.enabled || !this.stream || !loadSettings().voiceEnabled) {
      this.disable();
      return;
    }

    const mime = pickMime();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(
        this.stream,
        mime ? { mimeType: mime } : undefined,
      );
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

    if (blob.size < 1200 || blob.size > 800_000) return;
    try {
      const buf = await blob.arrayBuffer();
      this.sender?.(buf, blob.type || "audio/webm");
    } catch {
      /* ignore */
    }
  }

  private ensureCtx(): AudioContext | undefined {
    const Ctor =
      (typeof AudioContext !== "undefined" && AudioContext) ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
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

  async play(id: string, data: ArrayBuffer, _mime: string) {
    if (!loadSettings().voiceEnabled) return;
    const ctx = this.ensureCtx();
    if (!ctx || !this.gain) return;

    const ab = ArrayBuffer.isView(data)
      ? ((data as ArrayBufferView).buffer as ArrayBuffer).slice(0)
      : (data as ArrayBuffer).slice(0);
    let buffer: AudioBuffer;
    try {
      buffer = await ctx.decodeAudioData(ab);
    } catch {
      return;
    }
    const now = ctx.currentTime;
    let start = this.nextTime.get(id) ?? 0;

    if (start < now + 0.02) start = now + VoiceChat.JITTER_S;

    if (start > now + 1.0) start = now + 1.0;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.gain);
    src.start(start);
    this.nextTime.set(id, start + buffer.duration);
  }

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
