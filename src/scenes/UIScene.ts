import Phaser from "phaser";
import { gameSocket } from "../network/socket";
import { WorldScene } from "./WorldScene";

// ── Layout constants ──────────────────────────────────────────────────────────
const SLOT     = 38;
const GAP      = 2;
const SLOTS    = 9;
const BAR_W    = SLOTS * SLOT + (SLOTS - 1) * GAP; // 358

// heart / hunger icons: 7 cols × 6 rows at 2 px/cell → 14 × 12 px, 2 px gap → 16 px pitch
const ICON_P   = 16;   // pitch (icon width + gap)
const ICONS    = 10;   // hearts / hunger count

// ── Pixel-art patterns ────────────────────────────────────────────────────────
const HEART_PAT = [
  [0,1,1,0,0,1,1,0],
  [1,1,1,1,1,1,1,1],
  [1,1,1,1,1,1,1,1],
  [0,1,1,1,1,1,1,0],
  [0,0,1,1,1,1,0,0],
  [0,0,0,1,1,0,0,0],
];
const HUNGER_PAT = [
  [0,0,1,1,1,0,0,0],
  [0,1,1,1,1,1,0,0],
  [1,1,1,1,1,1,0,0],
  [0,1,1,1,1,0,0,0],
  [0,0,1,1,0,1,1,0],
  [0,0,0,1,1,1,0,0],
];

function stampIcon(
  g: Phaser.GameObjects.Graphics,
  pat: number[][],
  x: number, y: number,
  fill: number, hi: number,
) {
  const S = 2;
  // drop shadow
  g.fillStyle(0x000000, 0.75);
  for (let r = 0; r < pat.length; r++)
    for (let c = 0; c < pat[r].length; c++)
      if (pat[r][c]) g.fillRect(x + c * S + 1, y + r * S + 1, S, S);
  // body
  g.fillStyle(fill, 1);
  for (let r = 0; r < pat.length; r++)
    for (let c = 0; c < pat[r].length; c++)
      if (pat[r][c]) g.fillRect(x + c * S, y + r * S, S, S);
  // top-left highlight
  g.fillStyle(hi, 1);
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < pat[r].length; c++)
      if (pat[r][c]) g.fillRect(x + c * S, y + r * S, 1, 1);
}

export class UIScene extends Phaser.Scene {
  private worldScene!: WorldScene;
  private posText!: Phaser.GameObjects.Text;
  private onlineDot!: Phaser.GameObjects.Arc;

  constructor() {
    super({ key: "UIScene" });
  }

  init(data: { worldScene: WorldScene }) {
    this.worldScene = data.worldScene;
  }

  create() {
    const W = this.scale.width;
    const H = this.scale.height;
    const bx = (W - BAR_W) / 2;   // hotbar left edge
    const by = H - SLOT - 12;      // hotbar top edge

    const g = this.add.graphics();

    // ── Bottom vignette ───────────────────────────────────────────────
    g.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0, 0, 0.55, 0.55);
    g.fillRect(0, H - 100, W, 100);

    // ── Hearts (above hotbar, left-aligned) ───────────────────────────
    const iconY = by - 22;
    for (let i = 0; i < ICONS; i++)
      stampIcon(g, HEART_PAT, bx + i * ICON_P, iconY, 0xcc2222, 0xff6666);

    // ── Hunger (above hotbar, right-aligned) ──────────────────────────
    for (let i = 0; i < ICONS; i++)
      stampIcon(g, HUNGER_PAT, bx + BAR_W - (i + 1) * ICON_P + 2, iconY, 0x8b5e1a, 0xc8923a);

    // ── XP bar ────────────────────────────────────────────────────────
    const xpY = by - 7;
    g.fillStyle(0x000000, 0.7);
    g.fillRect(bx, xpY, BAR_W, 5);
    g.fillStyle(0x7dda1c, 1);
    g.fillRect(bx, xpY, Math.round(BAR_W * 0.35), 5);

    // ── Hotbar frame ──────────────────────────────────────────────────
    g.fillStyle(0x555555, 1);
    g.fillRect(bx - 2, by - 2, BAR_W + 4, SLOT + 4);
    g.fillStyle(0x222222, 1);
    g.fillRect(bx - 1, by - 1, BAR_W + 2, SLOT + 2);

    // ── Slots ─────────────────────────────────────────────────────────
    for (let i = 0; i < SLOTS; i++)
      this.drawSlot(g, bx + i * (SLOT + GAP), by, i === 0);

    // ── Crosshair ─────────────────────────────────────────────────────
    const cx = Math.round(W / 2);
    const cy = Math.round(H / 2);
    g.fillStyle(0x000000, 0.5);
    g.fillRect(cx - 8, cy - 1, 16, 3);
    g.fillRect(cx - 1, cy - 8, 3, 16);
    g.fillStyle(0xffffff, 0.9);
    g.fillRect(cx - 7, cy,     6, 1);   // left arm
    g.fillRect(cx + 2, cy,     6, 1);   // right arm
    g.fillRect(cx,     cy - 7, 1, 6);   // top arm
    g.fillRect(cx,     cy + 2, 1, 6);   // bottom arm

    // ── Coordinates (top-left, Minecraft debug style) ─────────────────
    this.posText = this.add
      .text(5, 5, "", {
        fontFamily: '"Press Start 2P"',
        fontSize: "7px",
        color: "#ffffff",
      })
      .setShadow(1, 1, "#000000", 0, true, true);

    // tiny online dot next to coords
    this.onlineDot = this.add.arc(6, 26, 3, 0, 360, false, 0x444444);
  }

  private drawSlot(g: Phaser.GameObjects.Graphics, x: number, y: number, selected: boolean) {
    // fill
    g.fillStyle(0x1c1c1c, 1);
    g.fillRect(x, y, SLOT, SLOT);

    if (selected) {
      g.lineStyle(2, 0xffffff, 1);
      g.strokeRect(x - 1, y - 1, SLOT + 2, SLOT + 2);
    } else {
      // bevel: bright top-left
      g.lineStyle(1, 0x575757, 1);
      g.beginPath();
      g.moveTo(x, y + SLOT - 1);
      g.lineTo(x, y);
      g.lineTo(x + SLOT - 1, y);
      g.strokePath();
      // dark bottom-right
      g.lineStyle(1, 0x111111, 1);
      g.beginPath();
      g.moveTo(x + SLOT, y);
      g.lineTo(x + SLOT, y + SLOT);
      g.lineTo(x, y + SLOT);
      g.strokePath();
    }
  }

  update() {
    this.onlineDot.setFillStyle(gameSocket.connected ? 0x44cc66 : 0x555555);
    const p = this.worldScene?.getLocalPlayer();
    if (p) this.posText.setText(`XYZ  ${p.cx} / 64 / ${p.cy}`);
  }
}
