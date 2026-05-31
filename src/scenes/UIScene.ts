import Phaser from "phaser";
import { DialogueBox } from "../ui/DialogueBox";
import { ChatBox } from "../ui/ChatBox";
import { FONT, FONT_EMOJI, FONT_CHAT, FONT_TITLE, COLORS, CURSORS } from "../ui/theme";
import { panel, playUiSound } from "../ui/UIKit";
import { EMOTES } from "../ui/emotes";
import { gameSocket } from "../network/socket";
import { getAccountId } from "../network/playerIdentity";
import { loadSettings } from "../data/Settings";
import { musicEngine } from "../audio/MusicEngine";
import type { ChatMessage, PlayerDirEntry, ModRole } from "../types/network";

// A HUD object we can nudge by (dx, dy) on resize.
type Movable = Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform;

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
  private lastTimeLabel = "";
  private heartIcons: Phaser.GameObjects.Graphics[] = [];
  private hp = 10;
  private hpMax = 10;
  private pixels = 0;
  private flashTween?: Phaser.Tweens.Tween;
  // Unread-notification badge on the inbox button.
  private unread = 0;
  private badgeBg?: Phaser.GameObjects.Arc;
  private badgeText?: Phaser.GameObjects.Text;

  // Tab player list (online players only). Held open while Tab is down.
  private playerListOpen = false;
  private latestPlayers: PlayerDirEntry[] = [];
  private playerListObjects: Phaser.GameObjects.GameObject[] = [];

  // Corner-anchored HUD groups, tracked so they can be shifted as a unit when
  // the canvas resizes (RESIZE scale mode / fullscreen). We record the canvas
  // size they were last laid out against and slide the whole group by the
  // delta — no per-element re-layout needed.
  private socialObjects: Movable[] = [];
  private emoteObjects: Movable[] = [];
  private socialBaseW = 0;
  private emoteBaseW = 0;
  private emoteBaseH = 0;

  // Moderation: our own role + the HUD shield button (built lazily once we
  // learn we're staff, then shown/hidden as the role changes).
  private adminRole: ModRole = null;
  private adminBtn?: { bg: Phaser.GameObjects.NineSlice; icon: Phaser.GameObjects.Text; tooltip: Phaser.GameObjects.Text };

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
    this.buildMobileControls();

    // Procedural background music, gated on the sound setting and the day
    // cycle. Resume the audio context on the first input (autoplay policy).
    musicEngine.start(() => this.dayPhase());
    musicEngine.setEnabled(loadSettings().soundEnabled);
    this.input.once("pointerdown", () => musicEngine.resume());
    this.input.keyboard?.once("keydown", () => musicEngine.resume());

    // Live roster for the Tab player list (filtered to online on render).
    gameSocket.on("players:list", this.onPlayersList);

    // Reflow the HUD whenever the canvas resizes (fullscreen / window drag).
    this.scale.on("resize", this.layout, this);
    this.events.once("shutdown", () => {
      musicEngine.stop();
      gameSocket.off("players:list", this.onPlayersList);
      this.scale.off("resize", this.layout, this);
    });
  }

  // Slide the corner-anchored HUD groups to match the new canvas size, and
  // re-anchor the centred / edge-bound widgets. Called on every resize.
  private layout = (gameSize: Phaser.Structs.Size) => {
    const w = gameSize.width;
    const h = gameSize.height;
    this.nightOverlay?.setSize(w, h);
    this.statusBg?.setX(w / 2);
    this.statusText?.setX(w / 2);

    const sdx = w - this.socialBaseW;
    if (sdx !== 0) {
      for (const o of this.socialObjects) o.x += sdx;
      this.socialBaseW = w;
    }
    const edx = w - this.emoteBaseW;
    const edy = h - this.emoteBaseH;
    if (edx !== 0 || edy !== 0) {
      for (const o of this.emoteObjects) {
        o.x += edx;
        o.y += edy;
      }
      this.emoteBaseW = w;
      this.emoteBaseH = h;
    }

    this.chat?.relayout();
    if (this.playerListOpen) this.renderPlayerList();
  };

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
    this.socialBaseW = this.scale.width;
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
    this.socialObjects.push(this.badgeBg, this.badgeText);
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
    this.socialObjects.push(bg, icon, tooltip);
    return bg;
  }

  // ── Admin / moderation ────────────────────────────────────────────

  // Set our moderation role (from init / live role changes). Builds the HUD
  // shield button on first staff role, then toggles its visibility.
  setAdminRole(role: ModRole) {
    this.adminRole = role;
    if (role && !this.adminBtn) this.buildAdminButton();
    const show = role !== null;
    this.adminBtn?.bg.setVisible(show).setActive(show);
    this.adminBtn?.icon.setVisible(show);
    if (!show) this.adminBtn?.tooltip.setVisible(false);
  }

  // A shield button to the left of the other corner buttons (4th slot).
  private buildAdminButton() {
    const SIZE = 38, GAP = 8;
    const x = this.scale.width - 12 - SIZE / 2 - 3 * (SIZE + GAP);
    const cy = 12 + SIZE / 2;
    const bg = this.add
      .nineslice(x, cy, "ui-panel-dark", undefined, SIZE, SIZE, 16, 16, 16, 16)
      .setOrigin(0.5)
      .setAlpha(0.96)
      .setDepth(50)
      .setInteractive({ cursor: CURSORS.pointer });
    const icon = this.add.text(x, cy, "🛡", { fontFamily: FONT_EMOJI, fontSize: "17px" }).setOrigin(0.5).setDepth(51);
    const tooltip = this.add
      .text(x, cy + SIZE / 2 + 6, "Admin", {
        fontFamily: FONT, fontSize: "8px", color: COLORS.text, backgroundColor: "#0a0f1ccc", padding: { x: 5, y: 3 },
      })
      .setOrigin(0.5, 0)
      .setDepth(62)
      .setVisible(false);
    bg.on("pointerover", () => { bg.setTint(0xffe08a).setScale(1.08); icon.setScale(1.08); tooltip.setVisible(true); });
    bg.on("pointerout", () => { bg.clearTint().setScale(1); icon.setScale(1); tooltip.setVisible(false); });
    bg.on("pointerdown", () => {
      playUiSound(this, "sfx-tap", 0.3);
      this.openAdmin();
    });
    this.socialObjects.push(bg, icon, tooltip);
    this.adminBtn = { bg, icon, tooltip };
  }

  private openAdmin() {
    if (this.adminRole === null) return;
    if (this.scene.isActive("AdminScene")) return;
    const from = this.scene.isActive("InteriorScene") ? "InteriorScene" : "WorldScene";
    this.scene.launch("AdminScene", { from, role: this.adminRole });
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
    this.emoteBaseW = this.scale.width;
    this.emoteBaseH = this.scale.height;
    const barPanel = panel(this, x, y, w, h, "ui-panel-dark").setOrigin(0, 0).setAlpha(0.95);
    this.emoteObjects.push(barPanel);

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
      this.emoteObjects.push(glyph, hit);
      hit.on("pointerover", () => glyph.setScale(1.2));
      hit.on("pointerout", () => glyph.setScale(1));
      hit.on("pointerdown", () => {
        gameSocket.sendEmote(e.key);
        playUiSound(this, "sfx-tap", 0.3);
      });
    });
  }

  // ── Mobile touch controls ─────────────────────────────────────────

  // The active gameplay scene (open world or house interior) that the
  // on-screen controls should drive.
  private gameScene():
    | (Phaser.Scene & { setTouchDir(dx: number, dy: number): void; mobileInteract?: () => void })
    | undefined {
    for (const key of ["InteriorScene", "WorldScene"]) {
      const s = this.scene.get(key) as
        | (Phaser.Scene & { setTouchDir?: (dx: number, dy: number) => void; mobileInteract?: () => void })
        | undefined;
      if (s && this.scene.isActive(key) && typeof s.setTouchDir === "function") {
        return s as Phaser.Scene & { setTouchDir(dx: number, dy: number): void; mobileInteract?: () => void };
      }
    }
    return undefined;
  }

  // A movement D-pad (bottom-left) plus interact + chat buttons (bottom-right),
  // shown only on coarse-pointer (touch) devices so desktop play is unchanged.
  private buildMobileControls() {
    const coarse =
      (typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches) ||
      (navigator?.maxTouchPoints ?? 0) > 0;
    if (!coarse) return;

    const W = this.scale.width;
    const H = this.scale.height;

    // Sits above the bottom-left chat log/input bar so the two don't fight.
    const cx = 96;
    const cy = H - 156;
    const GAP = 58;
    const dpad = (bx: number, by: number, glyph: string, dx: number, dy: number) => {
      const SIZE = 64;
      const bg = this.add
        .image(bx, by, "ui-round")
        .setDisplaySize(SIZE, SIZE)
        .setAlpha(0.9)
        .setDepth(70)
        .setInteractive();
      // Geometric triangle (not an emoji) so it stays crisp and box-free.
      this.add
        .text(bx, by, glyph, {
          fontFamily: FONT_CHAT, fontSize: "24px", color: "#ffffff",
          stroke: "#000000", strokeThickness: 4,
        })
        .setOrigin(0.5)
        .setDepth(71);
      const press = () => {
        bg.setTint(0xffd166);
        this.gameScene()?.setTouchDir(dx, dy);
      };
      const release = () => {
        bg.clearTint();
        this.gameScene()?.setTouchDir(0, 0);
      };
      bg.on("pointerdown", press);
      bg.on("pointerup", release);
      bg.on("pointerout", release);
      bg.on("pointerupoutside", release);
    };
    dpad(cx, cy - GAP, "▲", 0, -1);
    dpad(cx, cy + GAP, "▼", 0, 1);
    dpad(cx - GAP, cy, "◀", -1, 0);
    dpad(cx + GAP, cy, "▶", 1, 0);

    // Interact (E) and open-chat, stacked above the emote bar.
    this.touchActionButton(W - 70, H - 150, "✋", () => this.gameScene()?.mobileInteract?.());
    this.touchActionButton(W - 150, H - 110, "💬", () => {
      if (!this.isDialogueOpen) this.openChat();
    });
  }

  // A round tap button used by the mobile action cluster.
  private touchActionButton(bx: number, by: number, glyph: string, onTap: () => void) {
    const bg = this.add
      .image(bx, by, "ui-round")
      .setDisplaySize(64, 64)
      .setAlpha(0.9)
      .setDepth(70)
      .setInteractive();
    this.add
      .text(bx, by, glyph, { fontFamily: FONT_EMOJI, fontSize: "26px" })
      .setOrigin(0.5)
      .setDepth(71);
    bg.on("pointerdown", () => bg.setTint(0xffd166));
    bg.on("pointerup", () => {
      bg.clearTint();
      onTap();
      playUiSound(this, "sfx-tap", 0.3);
    });
    bg.on("pointerout", () => bg.clearTint());
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
      // Avoid re-rasterising these labels every frame — only on change.
      if (label !== this.lastTimeLabel) {
        this.lastTimeLabel = label;
        this.timeText.setText(label);
        // Sun during the bright half (morning/day), moon otherwise.
        this.timeIcon?.setText(phase >= 0.25 && phase < 0.75 ? "☀" : "🌙");
      }
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

  private lastCx = NaN;
  private lastCy = NaN;
  setCoords(cx: number, cy: number) {
    // setText re-rasterises the text texture; skip when the tile is unchanged
    // (this is called every frame from WorldScene.update).
    if (cx === this.lastCx && cy === this.lastCy) return;
    this.lastCx = cx;
    this.lastCy = cy;
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

  // ── Tab player list ──────────────────────────────────────────────

  get isPlayerListOpen(): boolean {
    return this.playerListOpen;
  }

  // Show the online-player roster (held open while Tab is down). Asks the
  // server for a fresh directory; renders immediately from the last snapshot.
  showPlayerList() {
    if (this.playerListOpen) return;
    this.playerListOpen = true;
    gameSocket.requestPlayers();
    this.renderPlayerList();
  }

  hidePlayerList() {
    if (!this.playerListOpen) return;
    this.playerListOpen = false;
    this.destroyPlayerList();
  }

  private onPlayersList = (data: { players: PlayerDirEntry[] }) => {
    this.latestPlayers = data.players;
    if (this.playerListOpen) this.renderPlayerList();
  };

  private destroyPlayerList() {
    for (const o of this.playerListObjects) o.destroy();
    this.playerListObjects.length = 0;
  }

  private renderPlayerList() {
    if (!this.playerListOpen) return;
    this.destroyPlayerList();

    const W = this.scale.width;
    const H = this.scale.height;
    const online = this.latestPlayers
      .filter((p) => p.online)
      .sort((a, b) => a.name.localeCompare(b.name));

    const rowH = 26;
    const headerH = 46;
    const panelW = 320;
    const bodyH = Math.max(rowH, online.length * rowH);
    const panelH = headerH + bodyH + 18;
    const cx = W / 2;
    const cy = H / 2;
    const top = cy - panelH / 2;
    const left = cx - panelW / 2;

    const dim = this.add
      .rectangle(0, 0, W, H, 0x000000, 0.4)
      .setOrigin(0)
      .setDepth(20000);
    const box = this.add
      .nineslice(cx, cy, "ui-panel-dark", undefined, panelW, panelH, 20, 20, 20, 20)
      .setOrigin(0.5)
      .setAlpha(0.98)
      .setDepth(20001);
    const title = this.add
      .text(cx, top + 24, `PLAYERS ONLINE  (${online.length})`, {
        fontFamily: FONT_TITLE,
        fontSize: "15px",
        color: COLORS.accent,
      })
      .setOrigin(0.5)
      .setResolution(3)
      .setDepth(20002);
    this.playerListObjects.push(dim, box, title);

    if (online.length === 0) {
      const empty = this.add
        .text(cx, top + headerH + rowH / 2, "No one online", {
          fontFamily: FONT_CHAT,
          fontSize: "14px",
          color: COLORS.textDim,
        })
        .setOrigin(0.5)
        .setResolution(3)
        .setDepth(20002);
      this.playerListObjects.push(empty);
      return;
    }

    const myId = getAccountId();
    online.forEach((p, i) => {
      const ry = top + headerH + i * rowH + rowH / 2;
      const dot = this.add.circle(left + 28, ry, 4, 0x4ade80).setDepth(20002);
      const mine = p.accountId === myId;
      const name = this.add
        .text(left + 44, ry, mine ? `${p.name}  (you)` : p.name, {
          fontFamily: FONT_CHAT,
          fontSize: "15px",
          color: mine ? COLORS.accent : COLORS.text,
        })
        .setOrigin(0, 0.5)
        .setResolution(3)
        .setDepth(20002);
      this.playerListObjects.push(dot, name);
    });
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
