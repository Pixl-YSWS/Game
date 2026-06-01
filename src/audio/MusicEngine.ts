const TRACK_URL = "assets/songs/climbing_the_clocktower.mp3";
const TARGET_VOL = 0.4;
const FADE_MS = 600;

class MusicEngine {
  private audio?: HTMLAudioElement;
  private enabled = false;
  private started = false;
  private fadeTimer?: ReturnType<typeof setInterval>;

  start() {
    this.started = true;
    this.enabled = true;
    this.ensureAudio();
    this.play();
    this.applyVolume();
  }

  resume() {
    this.ensureAudio();
    if (this.enabled && this.started) this.play();
  }

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
      audio.volume = Math.min(
        1,
        Math.max(0, start + (target - start) * (i / steps)),
      );
      if (i >= steps) {
        clearInterval(this.fadeTimer);
        this.fadeTimer = undefined;

        if (target === 0) audio.pause();
      }
    }, 40);
  }
}

export const musicEngine = new MusicEngine();
