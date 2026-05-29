import Phaser from "phaser";
import { DialogueBox } from "../ui/DialogueBox";

// Single UI scene running on top of WorldScene / InteriorScene. Its camera
// is at zoom 1 with no scroll, so every UI element sits at fixed canvas
// pixels regardless of the world camera's zoom.
export class UIScene extends Phaser.Scene {
  private box?: DialogueBox;
  private statusText?: Phaser.GameObjects.Text;
  private coordText?: Phaser.GameObjects.Text;
  private pixelText?: Phaser.GameObjects.Text;
  private timeText?: Phaser.GameObjects.Text;
  private heartIcons: Phaser.GameObjects.Graphics[] = [];
  private hp = 10;
  private hpMax = 10;
  private pixels = 0;
  private flashTween?: Phaser.Tweens.Tween;

  // Night overlay + day-cycle anchor. The overlay sits at depth -10 so all
  // HUD elements and the dialogue panel render above it.
  private nightOverlay?: Phaser.GameObjects.Rectangle;
  private dayEpoch = 0; // local Date.now() that corresponds to t=0
  private dayLengthMs = 0;

  constructor() {
    super({ key: "UIScene" });
  }

  create() {
    const baseX = 8;

    // Full-canvas overlay used to darken the world at night. Alpha is
    // recomputed each frame in update() from the day cycle anchor.
    this.nightOverlay = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, 0x0a0a3e, 0)
      .setOrigin(0)
      .setDepth(-10);

    this.statusText = this.add.text(baseX, 8, "", {
      fontFamily: '"Press Start 2P"',
      fontSize: "8px",
      color: "#ffffff",
      stroke: "#000000",
      strokeThickness: 3,
    });

    const heartsY = 24;
    for (let i = 0; i < this.hpMax; i++) {
      const g = this.add.graphics();
      g.x = baseX + i * 14;
      g.y = heartsY;
      this.heartIcons.push(g);
    }
    this.refreshHearts();

    this.coordText = this.add.text(baseX, heartsY + 22, "", {
      fontFamily: '"Press Start 2P"',
      fontSize: "8px",
      color: "#ffffff",
      stroke: "#000000",
      strokeThickness: 3,
    });

    this.pixelText = this.add.text(baseX, heartsY + 36, "0p", {
      fontFamily: '"Press Start 2P"',
      fontSize: "8px",
      color: "#ffd24a",
      stroke: "#000000",
      strokeThickness: 3,
    });

    this.timeText = this.add.text(baseX, heartsY + 50, "", {
      fontFamily: '"Press Start 2P"',
      fontSize: "8px",
      color: "#aabbff",
      stroke: "#000000",
      strokeThickness: 3,
    });

    this.box = new DialogueBox(this);
  }

  setDayCycle(tNow: number, dayLengthMs: number, _serverNow: number) {
    this.dayLengthMs = dayLengthMs;
    // Treat the local clock and server clock as in sync (close enough for
    // a visual cycle). Anchor: the local Date.now() that maps to t=0.
    this.dayEpoch = Date.now() - tNow * dayLengthMs;
  }

  update() {
    if (this.dayLengthMs <= 0 || !this.nightOverlay) return;
    const t = (((Date.now() - this.dayEpoch) % this.dayLengthMs) + this.dayLengthMs) % this.dayLengthMs;
    const phase = t / this.dayLengthMs; // 0..1
    // Brightness peaks at noon (phase 0.5), troughs at midnight (phase 0 or 1).
    const brightness = (1 - Math.cos(2 * Math.PI * phase)) / 2;
    const darkness = (1 - brightness) * 0.55; // max 55% dark at midnight
    this.nightOverlay.setAlpha(darkness);

    if (this.timeText) {
      const label = phase < 0.25 ? "Night" : phase < 0.5 ? "Morning" : phase < 0.75 ? "Day" : "Evening";
      this.timeText.setText(label);
    }
  }

  // ── HUD setters (called by WorldScene) ───────────────────────────

  setStatus(text: string) {
    this.statusText?.setText(text);
  }

  setCoords(cx: number, cy: number) {
    this.coordText?.setText(`X ${cx}  Y ${cy}`);
  }

  setHp(hp: number, hpMax?: number) {
    if (hpMax !== undefined && hpMax !== this.hpMax) {
      // Cheap rebuild if max changes — currently never does, but free safety.
      for (const g of this.heartIcons) g.destroy();
      this.heartIcons.length = 0;
      this.hpMax = hpMax;
      for (let i = 0; i < this.hpMax; i++) {
        const g = this.add.graphics();
        g.x = 8 + i * 14;
        g.y = 24;
        this.heartIcons.push(g);
      }
    }
    this.hp = hp;
    this.refreshHearts();
  }

  // Public read of the current pixel total — used by ShopScene to seed its
  // header from the live HUD value.
  get walletTotal(): number {
    return this.pixels;
  }

  setWallet(pixels: number, delta: number) {
    this.pixels = pixels;
    this.pixelText?.setText(`${this.pixels}p`);
    if (delta > 0 && this.pixelText) {
      this.flashTween?.stop();
      this.pixelText.setScale(1.6);
      this.flashTween = this.tweens.add({
        targets: this.pixelText,
        scale: 1,
        duration: 280,
        ease: "Quad.easeOut",
      });
    }
  }

  // ── Dialogue passthrough ─────────────────────────────────────────

  get isDialogueOpen(): boolean {
    return this.box?.isOpen ?? false;
  }
  openDialogue(speaker: string, lines: string[]) {
    this.box?.open(speaker, lines);
  }
  advanceDialogue(): boolean {
    return this.box?.advance() ?? false;
  }
  closeDialogue() {
    this.box?.close();
  }

  // ── Internals ────────────────────────────────────────────────────

  private refreshHearts() {
    for (let i = 0; i < this.heartIcons.length; i++) {
      const g = this.heartIcons[i];
      g.clear();
      drawHeart(g, i < this.hp);
    }
  }
}

const HEART_PIXELS: { x: number; y: number }[] = (() => {
  const rows = [
    "0110011",
    "1111111",
    "1111111",
    "1111111",
    "0111110",
    "0011100",
    "0001000",
  ];
  const pts: { x: number; y: number }[] = [];
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      if (rows[r][c] === "1") pts.push({ x: c, y: r });
    }
  }
  return pts;
})();

function drawHeart(g: Phaser.GameObjects.Graphics, filled: boolean) {
  const PX = 2;
  g.fillStyle(0x000000, 0.7);
  for (const { x, y } of HEART_PIXELS) g.fillRect(x * PX + 1, y * PX + 1, PX, PX);
  g.fillStyle(filled ? 0xcc2222 : 0x3a1212, 1);
  for (const { x, y } of HEART_PIXELS) g.fillRect(x * PX, y * PX, PX, PX);
  if (filled) {
    g.fillStyle(0xff8888, 1);
    for (const { x, y } of HEART_PIXELS) {
      if (y < 2) g.fillRect(x * PX, y * PX, PX, 1);
    }
  }
}
