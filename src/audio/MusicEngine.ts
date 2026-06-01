// Background music. Plays a looping music track shipped in
// public/assets/songs via a plain HTMLAudioElement, so it stays decoupled from
// any single Phaser scene (the engine is a process-wide singleton). Honours the
// sound setting and respects the browser autoplay policy: the first user
// gesture must call resume() before sound is allowed to start.

const TRACK_URL = "assets/songs/climbing_the_clocktower.mp3";
const TARGET_VOL = 0.4;
const FADE_MS = 600;

class MusicEngine {
  private audio?: HTMLAudioElement;
  private enabled = false;
  private started = false;
  private fadeTimer?: ReturnType<typeof setInterval>;

  // Begin playing. Safe to call repeatedly; only the first call wires up audio.
  start() {
    this.started = true;
    this.enabled = true;
    this.ensureAudio();
    this.play();
    this.applyVolume();
  }

  // Must be called from within a user-gesture handler at least once so the
  // browser allows playback (autoplay policy). No-op when muted/stopped.
  resume() {
    this.ensureAudio();
    if (this.enabled && this.started) this.play();
  }

  // Mute/unmute without tearing down the element. No-op if unchanged.
  setEnabled(on: boolean) {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) this.resume();
    this.applyVolume();
  }

  stop() {
    this.started = false;
    this.applyVolume();
  }

  private ensureAudio() {
    if (this.audio) return;
    const a = new Audio(TRACK_URL);
    a.loop = true;
    a.preload = "auto";
    a.volume = 0;
    this.audio = a;
  }

  private play() {
    // Autoplay rejection (before a user gesture) is expected — swallow it; the
    // next resume() from a real gesture will succeed.
    void this.audio?.play().catch(() => {});
  }

  private applyVolume() {
    if (!this.audio) return;
    const target = this.enabled && this.started ? TARGET_VOL : 0;
    if (this.fadeTimer) clearInterval(this.fadeTimer);
    const audio = this.audio;
    const start = audio.volume;
    const steps = Math.max(1, Math.round(FADE_MS / 40));
    let i = 0;
    this.fadeTimer = setInterval(() => {
      i++;
      audio.volume = Math.min(1, Math.max(0, start + (target - start) * (i / steps)));
      if (i >= steps) {
        clearInterval(this.fadeTimer);
        this.fadeTimer = undefined;
        // Pause once fully faded out so a muted track isn't decoding silently.
        if (target === 0) audio.pause();
      }
    }, 40);
  }
}

export const musicEngine = new MusicEngine();
