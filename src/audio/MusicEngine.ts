// Procedural ambient music. There are no music files in the asset packs (only
// UI blips), so rather than ship a download we synthesise a gentle, endless
// background track with the Web Audio API: soft pentatonic arpeggios over a
// slow bass drone. Pentatonic scales have no harsh intervals, so randomised
// note choices always sound consonant. The scale shifts from major (day) to
// minor (night) with the world's day/night phase.

const MAJOR_PENT = [0, 2, 4, 7, 9];
const MINOR_PENT = [0, 3, 5, 7, 10];
const ROOT_HZ = 220; // A3
const STEP_MS = 300; // one arpeggio note per step

function hz(semitones: number): number {
  return ROOT_HZ * Math.pow(2, semitones / 12);
}

class MusicEngine {
  private ctx?: AudioContext;
  private master?: GainNode;
  private filter?: BiquadFilterNode;
  private timer?: ReturnType<typeof setTimeout>;
  private step = 0;
  private enabled = false;
  private started = false;
  private phase: () => number = () => 0.5;
  private readonly targetVol = 0.07;

  // Begin playing, reading the day/night phase (0..1) from `phase`.
  start(phase: () => number) {
    this.phase = phase;
    this.started = true;
    this.enabled = true;
    this.ensureCtx();
    void this.ctx?.resume();
    this.applyVolume();
    if (this.timer == null) this.tick();
  }

  // Must be called from within a user-gesture handler at least once so the
  // AudioContext is allowed to produce sound (browser autoplay policy).
  resume() {
    this.ensureCtx();
    void this.ctx?.resume();
  }

  // Mute/unmute without tearing down the scheduler. No-op if unchanged.
  setEnabled(on: boolean) {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) this.resume();
    this.applyVolume();
  }

  stop() {
    this.started = false;
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.ctx && this.master) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.4);
    }
  }

  private ensureCtx() {
    if (this.ctx) return;
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 1300; // round off the edges
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.filter.connect(this.master);
    this.master.connect(this.ctx.destination);
  }

  private applyVolume() {
    if (!this.ctx || !this.master) return;
    const v = this.enabled && this.started ? this.targetVol : 0;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.linearRampToValueAtTime(v, now + 0.8);
  }

  private tick = () => {
    this.timer = setTimeout(this.tick, STEP_MS);
    if (!this.ctx || !this.filter || this.ctx.state !== "running") return;

    // Near midnight (phase ~0 / ~1) cos is high → minor + lower register.
    const night = Math.cos(2 * Math.PI * this.phase()) > 0.25;
    const scale = night ? MINOR_PENT : MAJOR_PENT;
    const base = night ? -12 : 0;

    // Walk the scale up then down, jumping octaves now and then for movement.
    const len = scale.length;
    const cycle = Math.floor(this.step / len) % 2 === 0;
    const i = this.step % len;
    const deg = scale[cycle ? i : len - 1 - i];
    const oct = this.step % 8 < 4 ? 12 : 0;
    this.playNote(hz(deg + base + oct), 0.4, this.step % 3 === 0 ? "triangle" : "sine", 0.55);

    // A soft drone on the downbeat for warmth.
    if (this.step % 8 === 0) this.playNote(hz(scale[0] + base - 12), 1.8, "sine", 0.5);
    this.step++;
  };

  private playNote(frequency: number, dur: number, type: OscillatorType, vel: number) {
    if (!this.ctx || !this.filter) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = frequency;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.filter);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }
}

export const musicEngine = new MusicEngine();
