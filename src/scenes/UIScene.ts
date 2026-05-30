import Phaser from "phaser";
import { DialogueBox } from "../ui/DialogueBox";
import { ChatBox } from "../ui/ChatBox";
import { FONT, FONT_EMOJI, COLORS, CURSORS } from "../ui/theme";
import { panel, playUiSound } from "../ui/UIKit";
import { EMOTES } from "../ui/emotes";
import { gameSocket } from "../network/socket";
import { loadSettings } from "../data/Settings";
import { musicEngine } from "../audio/MusicEngine";
import type { ChatMessage } from "../types/network";

// Single UI scene running on top of WorldScene / InteriorScene. Its camera
// is at zoom 1 with no scroll, so every UI element sits at fixed canvas
// pixels regardless of the world camera's zoom.
export class UIScene extends Phaser.Scene {
  private box?: DialogueBox;
  private chat?: ChatBox;
  private statusText?: Phaser.GameObjects.Text;
  private statusBg?: Phaser.GameObjects.Rectangle;
  private coordText?: Phaser.GameObjects.Text;
  private pixelText?: Phaser.GameObjects.Text;
  private timeText?: Phaser.GameObjects.Text;
  private timeIcon?: Phaser.GameObjects.Text;
  private heartIcons: Phaser.GameObjects.Graphics[] = [];
  private hp = 10;
  private hpMax = 10;
  private pixels = 0;
  private flashTween?: Phaser.Tweens.Tween;
  // Unread-notification badge on the inbox button.
  private unread = 0;
  private badgeBg?: Phaser.GameObjects.Arc;
  private badgeText?: Phaser.GameObjects.Text;

  // Night overlay + day-cycle anchor. The overlay sits at depth -10 so all
  // HUD elements and the dialogue panel render above it.
  private nightOverlay?: Phaser.GameObjects.Rectangle;
  private dayEpoch = 0; // local Date.now() that corresponds to t=0
  private dayLengthMs = 0;

  constructor() {
    super({ key: "UIScene" });
  }

  create() {
    // Full-canvas overlay used to darken the world at night. Alpha is
    // recomputed each frame in update() from the day cycle anchor.
    this.nightOverlay = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, 0x0a0a3e, 0)
      .setOrigin(0)
      .setDepth(-10);

    this.buildPlayerCard();
    this.buildStatusBar();

    this.box = new DialogueBox(this);
    this.chat = new ChatBox(this);
    this.buildEmoteBar();
    this.buildSocialButtons();

    // Procedural background music, gated on the sound setting and the day
    // cycle. Resume the audio context on the first input (autoplay policy).
    musicEngine.start(() => this.dayPhase());
    musicEngine.setEnabled(loadSettings().soundEnabled);
    this.input.once("pointerdown", () => musicEngine.resume());
    this.input.keyboard?.once("keydown", () => musicEngine.resume());
    this.events.once("shutdown", () => musicEngine.stop());
  }

  // Current day/night phase, 0..1 (0 = midnight). 0.5 when not yet synced.
  private dayPhase(): number {
    if (this.dayLengthMs <= 0) return 0.5;
    const t = (((Date.now() - this.dayEpoch) % this.dayLengthMs) + this.dayLengthMs) % this.dayLengthMs;
    return t / this.dayLengthMs;
  }

  // ── Player card (top-left): hearts + wallet + day/night ───────────
  private buildPlayerCard() {
    const X = 12, Y = 12, W = 188, H = 62;
    panel(this, X, Y, W, H, "ui-panel-dark").setOrigin(0, 0).setAlpha(0.96);
    const baseX = X + 15;

    // Hearts row.
    const heartsY = Y + 13;
    for (let i = 0; i < this.hpMax; i++) {
      const g = this.add.graphics();
      g.x = baseX + i * 13;
      g.y = heartsY;
      this.heartIcons.push(g);
    }
    this.refreshHearts();

    // Wallet + clock row, vertically centred on one line.
    const rowY = Y + 44;
    this.add.text(baseX, rowY, "🪙", { fontFamily: FONT_EMOJI, fontSize: "14px" }).setOrigin(0, 0.5);
    this.pixelText = this.add
      .text(baseX + 20, rowY, "0", { fontFamily: FONT, fontSize: "14px", color: COLORS.accent })
      .setOrigin(0, 0.5)
      .setResolution(3);

    this.timeIcon = this.add
      .text(X + W - 70, rowY, "☀", { fontFamily: FONT_EMOJI, fontSize: "13px" })
      .setOrigin(0, 0.5);
    this.timeText = this.add
      .text(X + W - 52, rowY, "", { fontFamily: FONT, fontSize: "9px", color: "#aabbff" })
      .setOrigin(0, 0.5)
      .setResolution(3);

    // Subtle coordinate readout tucked under the card.
    this.coordText = this.add
      .text(X + 2, Y + H + 4, "", { fontFamily: FONT, fontSize: "8px", color: COLORS.textDim })
      .setAlpha(0.5);
  }

  // ── Status / controls bar (top-centre) ────────────────────────────
  private buildStatusBar() {
    const y = 16;
    this.statusBg = this.add
      .rectangle(this.scale.width / 2, y, 10, 22, 0x0a0f1c, 0.62)
      .setStrokeStyle(1, 0xffffff, 0.14)
      .setOrigin(0.5)
      .setVisible(false);
    this.statusText = this.add
      .text(this.scale.width / 2, y, "", { fontFamily: FONT, fontSize: "9px", color: COLORS.text })
      .setOrigin(0.5)
      .setResolution(3);
  }

  // ── Invite + inbox buttons (top-right) ────────────────────────────
  private buildSocialButtons() {
    const world = () => this.scene.get("WorldScene") as
      | (Phaser.Scene & { openInvitePanel: () => void; openInbox: () => void; openInventory: () => void })
      | undefined;

    // Uniform square icon buttons, laid out right-to-left from the corner.
    const SIZE = 38, GAP = 8, cy = 12 + SIZE / 2;
    let x = this.scale.width - 12 - SIZE / 2;
    const inboxBtn = this.iconButton(x, cy, "✉", "Inbox  [N]", () => world()?.openInbox());
    x -= SIZE + GAP;
    this.iconButton(x, cy, "🎒", "Bag  [B]", () => world()?.openInventory());
    x -= SIZE + GAP;
    this.iconButton(x, cy, "✦", "Invite  [I]", () => world()?.openInvitePanel());

    // Unread badge pinned to the inbox button's top-right corner.
    const bx = inboxBtn.x + SIZE / 2 - 4;
    const by = inboxBtn.y - SIZE / 2 + 4;
    this.badgeBg = this.add.circle(bx, by, 8, 0xe5484d).setStrokeStyle(1.5, 0x0a0f1c).setDepth(60).setVisible(false);
    this.badgeText = this.add
      .text(bx, by, "", { fontFamily: FONT, fontSize: "9px", color: "#ffffff" })
      .setOrigin(0.5)
      .setResolution(3)
      .setDepth(61)
      .setVisible(false);
    this.refreshBadge();
  }

  // A square, panel-backed icon button with a hover tooltip + tint/scale.
  private iconButton(cx: number, cy: number, glyph: string, tip: string, onClick: () => void) {
    const SIZE = 38;
    const bg = this.add
      .nineslice(cx, cy, "ui-panel-dark", undefined, SIZE, SIZE, 16, 16, 16, 16)
      .setOrigin(0.5)
      .setAlpha(0.96)
      .setDepth(50)
      .setInteractive({ cursor: CURSORS.pointer });
    const icon = this.add
      .text(cx, cy, glyph, { fontFamily: FONT_EMOJI, fontSize: "17px" })
      .setOrigin(0.5)
      .setDepth(51);
    // Tooltip below the button, shown on hover.
    const tooltip = this.add
      .text(cx, cy + SIZE / 2 + 6, tip, {
        fontFamily: FONT,
        fontSize: "8px",
        color: COLORS.text,
        backgroundColor: "#0a0f1ccc",
        padding: { x: 5, y: 3 },
      })
      .setOrigin(0.5, 0)
      .setDepth(62)
      .setVisible(false);

    bg.on("pointerover", () => {
      bg.setTint(0xffe08a).setScale(1.08);
      icon.setScale(1.08);
      tooltip.setVisible(true);
    });
    bg.on("pointerout", () => {
      bg.clearTint().setScale(1);
      icon.setScale(1);
      tooltip.setVisible(false);
    });
    bg.on("pointerdown", () => {
      playUiSound(this, "sfx-tap", 0.3);
      onClick();
    });
    return bg;
  }

  // Public: refresh the unread badge from the server count.
  setUnread(n: number) {
    this.unread = Math.max(0, n | 0);
    this.refreshBadge();
  }

  private refreshBadge() {
    const show = this.unread > 0;
    this.badgeBg?.setVisible(show);
    this.badgeText?.setVisible(show).setText(this.unread > 9 ? "9+" : String(this.unread));
  }

  // ── Emote bar (bottom-right) ──────────────────────────────────────
  private buildEmoteBar() {
    const n = EMOTES.length;
    const cell = 40;
    const w = n * cell + 16;
    const h = cell + 16;
    const x = this.scale.width - w - 12;
    const y = this.scale.height - h - 12;
    panel(this, x, y, w, h, "ui-panel-dark").setOrigin(0, 0).setAlpha(0.95);

    EMOTES.forEach((e, i) => {
      const cx = x + 8 + i * cell + cell / 2;
      const cy = y + 8 + cell / 2;
      const glyph = this.add
        .text(cx, cy, e.glyph, { fontSize: "22px", fontFamily: FONT_EMOJI })
        .setOrigin(0.5);
      // A full-cell hit zone so the whole 40px square is clickable — a plain
      // Text only registers clicks over the glyph's tight bounds.
      const hit = this.add
        .zone(cx, cy, cell, cell)
        .setOrigin(0.5)
        .setInteractive({ cursor: CURSORS.pointer });
      hit.on("pointerover", () => glyph.setScale(1.2));
      hit.on("pointerout", () => glyph.setScale(1));
      hit.on("pointerdown", () => {
        gameSocket.sendEmote(e.key);
        playUiSound(this, "sfx-tap", 0.3);
      });
    });
  }

  setDayCycle(tNow: number, dayLengthMs: number, _serverNow: number) {
    this.dayLengthMs = dayLengthMs;
    // Treat the local clock and server clock as in sync (close enough for
    // a visual cycle). Anchor: the local Date.now() that maps to t=0.
    this.dayEpoch = Date.now() - tNow * dayLengthMs;
  }

  update() {
    // Keep the music's mute state in step with the sound setting (cheap —
    // loadSettings is cached and setEnabled is a no-op when unchanged).
    musicEngine.setEnabled(loadSettings().soundEnabled);

    if (this.dayLengthMs <= 0 || !this.nightOverlay) return;
    const phase = this.dayPhase(); // 0..1
    // Brightness peaks at noon (phase 0.5), troughs at midnight (phase 0 or 1).
    const brightness = (1 - Math.cos(2 * Math.PI * phase)) / 2;
    const darkness = (1 - brightness) * 0.55; // max 55% dark at midnight
    this.nightOverlay.setAlpha(darkness);

    if (this.timeText) {
      const label = phase < 0.25 ? "Night" : phase < 0.5 ? "Morning" : phase < 0.75 ? "Day" : "Evening";
      this.timeText.setText(label);
      // Sun during the bright half (morning/day), moon otherwise.
      this.timeIcon?.setText(phase >= 0.25 && phase < 0.75 ? "☀" : "🌙");
    }
  }

  // ── HUD setters (called by WorldScene) ───────────────────────────

  setStatus(text: string) {
    if (!this.statusText) return;
    this.statusText.setText(text);
    // Size the backing bar to the text so the centred pill always fits.
    const show = text.length > 0;
    this.statusText.setVisible(show);
    this.statusBg?.setVisible(show).setSize(this.statusText.width + 26, 24);
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
    // Coin icon precedes the number, so no "p" suffix needed.
    this.pixelText?.setText(`${this.pixels}`);
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

  // ── Chat passthrough ─────────────────────────────────────────────

  get isChatOpen(): boolean {
    return this.chat?.isOpen ?? false;
  }
  openChat() {
    this.chat?.open();
  }
  addChatMessage(msg: ChatMessage) {
    this.chat?.addMessage(msg);
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
