import Phaser from "phaser";
import { DialogueBox } from "../ui/DialogueBox";
import { ChatBox } from "../ui/ChatBox";
import { FONT, FONT_TITLE, COLORS, CURSORS, EMOTE_ATLAS } from "../ui/theme";
import { panel, playUiSound, uiImage } from "../ui/UIKit";
import { el, openDomModal, type DomModal } from "../ui/dom";
import { EMOTES, QUICK_EMOTES } from "../ui/emotes";
import { gameSocket } from "../network/socket";
import { getAccountId, getAccountName } from "../network/playerIdentity";
import { loadSettings, getKeybinds } from "../data/Settings";
import { musicEngine } from "../audio/MusicEngine";
import { voiceChat } from "../audio/VoiceChat";
import { eventToKeyName, prettyKey } from "./SettingsScene";
import type { ChatMessage, PlayerDirEntry, ModRole } from "../types/network";

type Movable = Phaser.GameObjects.GameObject &
  Phaser.GameObjects.Components.Transform;

type GameplayScene = Phaser.Scene & {
  setTouchDir(dx: number, dy: number): void;
  mobileInteract?: () => void;
  setSpeedMultiplier?: (mul: number) => void;
  teleport?: (cx: number, cy: number) => boolean;
  showSpeaking?: (id: string) => void;
};

const HUD_STYLE_ID = "pixl-hud-styles";
function injectHudStyles() {
  if (document.getElementById(HUD_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = HUD_STYLE_ID;
  style.textContent = `
#pixl-hud {
  position: fixed; inset: 0; pointer-events: none; z-index: 25;
  font-family: "Monocraft", "Pixelify Sans", monospace; color: #f4e3c2;
}
#pixl-hud .hud-panel {
  background: #2b1d12; border: 3px solid #17100a;
  box-shadow: inset 0 0 0 2px #6b4f33;
}
#pixl-hud .hud-topleft {
  position: absolute; top: 12px; left: 12px;
  display: flex; flex-direction: column; gap: 6px; align-items: flex-start;
}
#pixl-hud .hud-card { width: 200px; padding: 9px 13px 10px; }
#pixl-hud .hud-name {
  font-family: "Pixelify Sans", sans-serif; font-weight: 700;
  font-size: 15px; color: #ffd166; letter-spacing: 0.5px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
#pixl-hud .hud-hearts { display: flex; gap: 1px; margin: 5px 0 6px; font-size: 13px; line-height: 1; }
#pixl-hud .hud-hearts span { color: #3a1212; text-shadow: 0 1px 0 rgba(0,0,0,0.6); }
#pixl-hud .hud-hearts span.on { color: #cc2222; }
#pixl-hud .hud-cardrow { display: flex; align-items: center; justify-content: space-between; font-size: 13px; }
#pixl-hud .hud-pixels { color: #ffd166; transform-origin: left center; }
#pixl-hud .hud-pixels.bump { animation: hud-bump 280ms ease-out; }
@keyframes hud-bump { from { transform: scale(1.6); } to { transform: scale(1); } }
#pixl-hud .hud-clock { color: #c9b18c; font-size: 11px; }
#pixl-hud .hud-online {
  pointer-events: auto; cursor: ${CURSORS.pointer};
  display: flex; align-items: center; gap: 7px;
  padding: 4px 11px 3px; font-size: 11px;
}
#pixl-hud .hud-online:hover { background: #46301c; }
#pixl-hud .hud-online .dot { width: 8px; height: 8px; border-radius: 50%; background: #4ade80; }
#pixl-hud .hud-status {
  position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
  padding: 5px 12px 3px; font-size: 11px; white-space: nowrap;
  background: rgba(23, 16, 10, 0.7); border: 1px solid rgba(255, 255, 255, 0.14);
}
#pixl-hud .hud-status.hidden { display: none; }
#pixl-hud .hud-topright { position: absolute; top: 12px; right: 12px; display: flex; gap: 8px; }
#pixl-hud .hud-iconbtn {
  pointer-events: auto; position: relative; width: 46px; height: 46px;
  display: flex; align-items: center; justify-content: center;
  font-size: 22px; cursor: ${CURSORS.pointer};
}
#pixl-hud .hud-iconbtn:hover { background: #46301c; }
#pixl-hud .hud-iconbtn.hidden { display: none; }
#pixl-hud .hud-iconbtn .tip {
  position: absolute; top: 52px; left: 50%; transform: translateX(-50%);
  background: #17100acc; padding: 4px 7px; font-size: 11px; white-space: nowrap;
  opacity: 0; transition: opacity 0.1s; color: #f4e3c2;
}
#pixl-hud .hud-iconbtn:hover .tip { opacity: 1; }
#pixl-hud .hud-badge {
  position: absolute; top: -6px; right: -6px;
  min-width: 17px; height: 17px; box-sizing: border-box; border-radius: 9px;
  background: #e5484d; border: 2px solid #17100a; color: #fff;
  font-size: 9px; display: flex; align-items: center; justify-content: center;
  padding: 0 3px;
}
#pixl-hud .hud-badge.hidden { display: none; }
#pixl-hud .hud-coords {
  position: absolute; bottom: 6px; left: 8px; font-size: 9px;
  color: #c9b18c; opacity: 0.5;
}
`;
  document.head.appendChild(style);
}

export class UIScene extends Phaser.Scene {
  private box?: DialogueBox;
  private chat?: ChatBox;

  // ── DOM HUD chrome ────────────────────────────────────────────────
  private hudRoot?: HTMLDivElement;
  private elName?: HTMLDivElement;
  private elHearts?: HTMLDivElement;
  private elPixels?: HTMLSpanElement;
  private elClock?: HTMLSpanElement;
  private elStatus?: HTMLDivElement;
  private elOnline?: HTMLDivElement;
  private elCoords?: HTMLDivElement;
  private elBadge?: HTMLDivElement;
  private btnAdmin?: HTMLButtonElement;
  private btnMap?: HTMLButtonElement;

  private lastTimeLabel = "";
  private lastClock = "";
  private hp = 10;
  private hpMax = 10;
  private pixels = 0;

  private onlineCount = 1;
  private unread = 0;

  private playerListModal?: DomModal;
  private latestPlayers: PlayerDirEntry[] = [];

  // ── Emote bar / voice / mobile (still canvas) ─────────────────────
  private emoteObjects: Movable[] = [];
  private emoteBaseW = 0;
  private emoteBaseH = 0;
  private emotePopup?: Phaser.GameObjects.Container;
  private emotePopupOpen = false;
  private mobileReflow: ((w: number, h: number) => void)[] = [];
  private micBtn?: Phaser.GameObjects.Image;
  private micBusy = false;

  private adminRole: ModRole = null;

  private nightOverlay?: Phaser.GameObjects.Rectangle;
  private dayEpoch = 0;
  private dayLengthMs = 0;

  constructor() {
    super({ key: "UIScene" });
  }

  create() {
    this.nightOverlay = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, 0x0a0a3e, 0)
      .setOrigin(0)
      .setDepth(-10);

    this.buildHud();

    this.box = new DialogueBox(this);
    this.chat = new ChatBox(this);
    this.chat.onCommand = (raw) => this.handleChatCommand(raw);
    this.buildEmoteBar();
    this.buildVoiceButton();
    this.buildMobileControls();

    musicEngine.start();
    musicEngine.setEnabled(loadSettings().soundEnabled);
    this.input.once("pointerdown", () => musicEngine.resume());
    this.input.keyboard?.once("keydown", () => musicEngine.resume());

    gameSocket.on("players:list", this.onPlayersList);
    gameSocket.on("player:voice", this.onVoice);

    this.scale.on("resize", this.layout, this);
    this.events.once("shutdown", () => {
      musicEngine.stop();
      voiceChat.release();
      gameSocket.off("players:list", this.onPlayersList);
      gameSocket.off("player:voice", this.onVoice);
      this.scale.off("resize", this.layout, this);
      this.playerListModal?.destroy();
      this.hudRoot?.remove();
      this.hudRoot = undefined;
    });
  }

  // Only canvas elements need repositioning now — DOM chrome is anchored by CSS.
  private layout = (gameSize: Phaser.Structs.Size) => {
    const w = gameSize.width;
    const h = gameSize.height;
    this.nightOverlay?.setSize(w, h);

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
  };

  private dayPhase(): number {
    if (this.dayLengthMs <= 0) return 0.5;
    const t =
      (((Date.now() - this.dayEpoch) % this.dayLengthMs) + this.dayLengthMs) %
      this.dayLengthMs;
    return t / this.dayLengthMs;
  }

  // ── DOM HUD construction ──────────────────────────────────────────
  private buildHud() {
    injectHudStyles();
    const root = el("div");
    root.id = "pixl-hud";
    this.hudRoot = root;

    // Top-left: player card + online chip
    const topleft = el("div", "hud-topleft");
    const card = el("div", "hud-card hud-panel");
    this.elName = el("div", "hud-name", getAccountName() || "Player");
    this.elHearts = el("div", "hud-hearts");
    const row = el("div", "hud-cardrow");
    this.elPixels = el("span", "hud-pixels", "🪙 0");
    this.elClock = el("span", "hud-clock", "☀ --:--");
    row.append(this.elPixels, this.elClock);
    card.append(this.elName, this.elHearts, row);

    this.elOnline = el("div", "hud-online hud-panel");
    const dot = el("span", "dot");
    const onlineText = el("span", undefined, "1 online");
    this.elOnline.append(dot, onlineText);
    this.elOnline.dataset.label = "online";
    this.elOnline.addEventListener("click", () => {
      playUiSound(this, "sfx-tap", 0.3);
      if (this.playerListModal) this.hidePlayerList();
      else this.showPlayerList();
    });
    topleft.append(card, this.elOnline);
    root.append(topleft);

    // Top-center status pill
    this.elStatus = el("div", "hud-status hidden");
    root.append(this.elStatus);

    // Top-right action buttons
    const topright = el("div", "hud-topright");
    const world = () =>
      this.scene.get("WorldScene") as
        | (Phaser.Scene & {
            openInvitePanel: () => void;
            openInbox: () => void;
            openInventory: () => void;
          })
        | undefined;

    this.btnMap = this.iconButton("🗺", "Map Editor", () =>
      this.openMapEditor(),
    );
    this.btnMap.classList.add("hidden");
    this.btnAdmin = this.iconButton("🛡", "Admin", () => this.openAdmin());
    this.btnAdmin.classList.add("hidden");
    const invite = this.iconButton("✦", "Invite  [I]", () =>
      world()?.openInvitePanel(),
    );
    const bag = this.iconButton("🎒", "Bag  [B]", () => world()?.openInventory());
    const inbox = this.iconButton("✉", "Inbox  [N]", () =>
      world()?.openInbox(),
    );
    this.elBadge = el("div", "hud-badge hidden");
    inbox.append(this.elBadge);

    topright.append(this.btnMap, this.btnAdmin, invite, bag, inbox);
    root.append(topright);

    // Bottom-left coords
    this.elCoords = el("div", "hud-coords");
    root.append(this.elCoords);

    document.body.append(root);

    this.refreshHearts();
  }

  private iconButton(
    glyph: string,
    tip: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const b = el("button", "hud-iconbtn hud-panel");
    b.type = "button";
    b.append(document.createTextNode(glyph), el("span", "tip", tip));
    b.addEventListener("click", () => {
      playUiSound(this, "sfx-tap", 0.3);
      onClick();
    });
    return b;
  }

  // ── Online chip / player list ─────────────────────────────────────
  setOnlineCount(n: number) {
    this.onlineCount = Math.max(1, n | 0);
    const label = this.elOnline?.querySelector("span:last-child");
    if (label) label.textContent = `${this.onlineCount} online`;
  }

  get isPlayerListOpen(): boolean {
    return !!this.playerListModal;
  }

  showPlayerList() {
    if (this.playerListModal) return;
    const modal = openDomModal(this, {
      title: "Players Online",
      width: 320,
      onClose: () => this.hidePlayerList(),
    });
    this.playerListModal = modal;
    gameSocket.requestPlayers();
    this.renderPlayerList();
  }

  hidePlayerList() {
    this.playerListModal?.destroy();
    this.playerListModal = undefined;
  }

  private onPlayersList = (data: { players: PlayerDirEntry[] }) => {
    this.latestPlayers = data.players;
    if (this.playerListModal) this.renderPlayerList();
  };

  private renderPlayerList() {
    const modal = this.playerListModal;
    if (!modal) return;
    const online = this.latestPlayers
      .filter((p) => p.online)
      .sort((a, b) => a.name.localeCompare(b.name));
    modal.body.replaceChildren();

    if (online.length === 0) {
      modal.body.append(el("div", "pixl-row-meta", "No one online"));
      return;
    }
    const myId = getAccountId();
    const list = el("div", "pixl-list");
    for (const p of online) {
      const rowEl = el("div", "pixl-row");
      const dot = el("span");
      dot.style.cssText =
        "width:8px; height:8px; border-radius:50%; background:#4ade80; flex-shrink:0;";
      const mine = p.accountId === myId;
      const name = el(
        "div",
        "pixl-row-name",
        mine ? `${p.name}  (you)` : p.name,
      );
      if (mine) name.style.color = COLORS.accent;
      rowEl.append(dot, name);
      list.append(rowEl);
    }
    modal.body.append(list);
  }

  // ── Admin / map editor buttons ────────────────────────────────────
  setAdminRole(role: ModRole) {
    this.adminRole = role;
    this.btnAdmin?.classList.toggle("hidden", role === null);
    this.btnMap?.classList.toggle("hidden", role !== "admin");
  }

  private openAdmin() {
    if (this.adminRole === null) return;
    if (this.scene.isActive("AdminScene")) return;
    const from = this.scene.isActive("InteriorScene")
      ? "InteriorScene"
      : "WorldScene";
    this.scene.launch("AdminScene", { from, role: this.adminRole });
  }

  private openMapEditor() {
    if (this.adminRole !== "admin") return;
    if (this.scene.isActive("MapEditorScene")) return;
    this.scene.launch("MapEditorScene");
    this.scene.bringToTop("MapEditorScene");
  }

  // ── Unread badge ──────────────────────────────────────────────────
  setUnread(n: number) {
    this.unread = Math.max(0, n | 0);
    if (!this.elBadge) return;
    this.elBadge.classList.toggle("hidden", this.unread === 0);
    this.elBadge.textContent = this.unread > 9 ? "9+" : String(this.unread);
  }

  // ── Emote bar (canvas) ────────────────────────────────────────────
  private buildEmoteBar() {
    const cell = 40;
    const cells = QUICK_EMOTES.length + 1;
    const w = cells * cell + 16;
    const h = cell + 16;
    const x = this.scale.width - w - 12;
    const y = this.scale.height - h - 12;
    this.emoteBaseW = this.scale.width;
    this.emoteBaseH = this.scale.height;
    const barPanel = panel(this, x, y, w, h, "ui-panel-dark")
      .setOrigin(0, 0)
      .setAlpha(0.95);
    this.emoteObjects.push(barPanel);

    QUICK_EMOTES.forEach((e, i) => {
      const cx = x + 8 + i * cell + cell / 2;
      const cy = y + 8 + cell / 2;
      this.emoteObjects.push(
        ...this.emoteIcon(cx, cy, e.frame, () => this.sendEmote(e.key)),
      );
    });

    const ex = x + 8 + QUICK_EMOTES.length * cell + cell / 2;
    const ey = y + 8 + cell / 2;
    const moreBg = uiImage(this, ex, ey, "ui-round")
      .setDisplaySize(cell - 6, cell - 6)
      .setInteractive({ cursor: CURSORS.pointer });
    const moreIcon = this.add
      .text(ex, ey - 1, "•••", {
        fontFamily: FONT,
        fontSize: "16px",
        color: COLORS.text,
      })
      .setOrigin(0.5);
    moreBg.on("pointerover", () => moreBg.setTint(0xfff2cc));
    moreBg.on("pointerout", () => moreBg.clearTint());
    moreBg.on("pointerdown", () => {
      playUiSound(this, "sfx-tap", 0.3);
      this.toggleEmotePopup();
    });
    this.emoteObjects.push(moreBg, moreIcon);

    this.input.keyboard?.on("keydown-C", () => {
      if (this.isChatOpen || this.isDialogueOpen) return;
      this.toggleEmotePopup();
    });
  }

  private emoteIcon(
    cx: number,
    cy: number,
    frame: string,
    onClick: () => void,
    size = 28,
  ): Movable[] {
    const icon = this.add
      .image(cx, cy, EMOTE_ATLAS, frame)
      .setOrigin(0.5)
      .setDisplaySize(size, size);
    const hit = this.add
      .zone(cx, cy, size + 12, size + 12)
      .setOrigin(0.5)
      .setInteractive({ cursor: CURSORS.pointer });
    hit.on("pointerover", () => icon.setDisplaySize(size * 1.25, size * 1.25));
    hit.on("pointerout", () => icon.setDisplaySize(size, size));
    hit.on("pointerdown", onClick);
    return [icon, hit];
  }

  private sendEmote(key: string) {
    gameSocket.sendEmote(key);
    playUiSound(this, "sfx-tap", 0.3);
  }

  private toggleEmotePopup() {
    if (this.emotePopupOpen) {
      if (this.emotePopup) {
        const i = this.emoteObjects.indexOf(this.emotePopup);
        if (i >= 0) this.emoteObjects.splice(i, 1);
        this.emotePopup.destroy();
      }
      this.emotePopup = undefined;
      this.emotePopupOpen = false;
      return;
    }
    this.buildEmotePopup();
    this.emotePopupOpen = true;
  }

  private buildEmotePopup() {
    const cell = 44;
    const cols = 5;
    const rows = Math.ceil(EMOTES.length / cols);
    const padX = 10;
    const titleH = 22;
    const w = cols * cell + padX * 2;
    const h = rows * cell + padX + titleH;
    const right = this.scale.width - 12;
    const bottom = this.scale.height - 12 - (40 + 16) - 8;
    const x = right - w;
    const y = bottom - h;

    const container = this.add.container(0, 0).setDepth(60);
    const bg = panel(this, x, y, w, h, "ui-panel-dark")
      .setOrigin(0, 0)
      .setAlpha(0.98);
    const title = this.add
      .text(x + w / 2, y + 12, "EMOTES", {
        fontFamily: FONT_TITLE,
        fontSize: "12px",
        color: COLORS.accent,
      })
      .setOrigin(0.5);
    container.add([bg, title]);

    EMOTES.forEach((e, i) => {
      const cx = x + padX + (i % cols) * cell + cell / 2;
      const cy = y + titleH + padX + Math.floor(i / cols) * cell + cell / 2 - 4;
      const [icon, hit] = this.emoteIcon(
        cx,
        cy,
        e.frame,
        () => {
          this.sendEmote(e.key);
          this.toggleEmotePopup();
        },
        32,
      );
      container.add([icon, hit]);
    });

    this.emotePopup = container;
    this.emoteObjects.push(container);
  }

  // ── Voice button (canvas) ─────────────────────────────────────────
  private buildVoiceButton() {
    if (!voiceChat.supported) return;
    voiceChat.setSender((data, mime) => gameSocket.sendVoiceClip(data, mime));
    voiceChat.onStateChange((on) => this.setMicActive(on));

    const SIZE = 48;
    const emoteBarW = (QUICK_EMOTES.length + 1) * 40 + 16;
    const cx = this.scale.width - 12 - emoteBarW - 8 - SIZE / 2;
    const cy = this.scale.height - 12 - SIZE / 2 - 4;

    const bg = uiImage(this, cx, cy, "ui-round")
      .setDisplaySize(SIZE, SIZE)
      .setAlpha(0.95)
      .setDepth(50)
      .setInteractive({ cursor: CURSORS.pointer });
    const icon = this.add
      .image(cx, cy, "mc-icons", "icon_microphone")
      .setDisplaySize(26, 26)
      .setDepth(51);
    this.micBtn = bg;

    const tip = this.add
      .text(cx, cy - SIZE / 2 - 6, `Mic  [${prettyKey(getKeybinds().talk)}]`, {
        fontFamily: FONT,
        fontSize: "12px",
        color: COLORS.text,
        backgroundColor: "#17100acc",
        padding: { x: 6, y: 4 },
      })
      .setResolution(3)
      .setOrigin(0.5, 1)
      .setDepth(62)
      .setVisible(false);

    bg.on("pointerover", () => {
      tip.setText(`Mic  [${prettyKey(getKeybinds().talk)}]`).setVisible(true);
      if (!voiceChat.isEnabled) bg.setTint(0xfff2cc);
    });
    bg.on("pointerout", () => {
      tip.setVisible(false);
      this.setMicActive(voiceChat.isEnabled);
    });
    bg.on("pointerdown", () => this.toggleMic());

    this.input.keyboard?.on("keydown", (e: KeyboardEvent) => {
      if (e.repeat || this.isChatOpen || this.isDialogueOpen) return;
      if (!this.gameScene()) return;
      if (eventToKeyName(e) === getKeybinds().talk) this.toggleMic();
    });

    this.emoteObjects.push(bg, icon, tip);
  }

  private async toggleMic() {
    if (this.micBusy) return;
    this.micBusy = true;
    const wasOn = voiceChat.isEnabled;
    const on = await voiceChat.toggle();
    this.micBusy = false;
    this.setMicActive(on);
    if (!wasOn && !on) {
      this.chat?.addSystem(
        loadSettings().voiceEnabled
          ? "Microphone unavailable."
          : "Voice is off (Settings).",
      );
    } else {
      this.chat?.addSystem(on ? "Mic on — you're live." : "Mic off.");
    }
  }

  private setMicActive(on: boolean) {
    if (on) this.micBtn?.setTint(0xff6b6b);
    else this.micBtn?.clearTint();
  }

  private onVoice = ({
    id,
    data,
    mime,
  }: {
    id: string;
    data: ArrayBuffer;
    mime: string;
  }) => {
    voiceChat.play(id, data, mime);
    this.gameScene()?.showSpeaking?.(id);
  };

  private gameScene(): GameplayScene | undefined {
    for (const key of ["InteriorScene", "WorldScene"]) {
      const s = this.scene.get(key) as GameplayScene | undefined;
      if (s && this.scene.isActive(key) && typeof s.setTouchDir === "function") {
        return s;
      }
    }
    return undefined;
  }

  private handleChatCommand(raw: string): boolean {
    const parts = raw.slice(1).trim().split(/\s+/);
    const cmd = (parts[0] ?? "").toLowerCase();
    const isAdmin = this.adminRole === "admin" || this.adminRole === "subadmin";
    const say = (t: string) => this.chat?.addSystem(t);

    switch (cmd) {
      case "help":
        say(
          isAdmin
            ? "Commands: /help, /speed <1-8|reset>, /tp <x> <y>"
            : "Commands: /help. (Some commands are staff-only.)",
        );
        return true;
      case "speed": {
        if (!isAdmin) return say("You don't have permission to use /speed."), true;
        const arg = (parts[1] ?? "").toLowerCase();
        const n = arg === "reset" ? 1 : Number(arg);
        if (!Number.isFinite(n) || n < 1 || n > 8)
          return say("Usage: /speed <1-8|reset>"), true;
        this.gameScene()?.setSpeedMultiplier?.(n);
        return say(`Walk speed set to ${n}×.`), true;
      }
      case "tp": {
        if (!isAdmin) return say("You don't have permission to use /tp."), true;
        const x = Number(parts[1]);
        const y = Number(parts[2]);
        if (!Number.isInteger(x) || !Number.isInteger(y))
          return say("Usage: /tp <x> <y>"), true;
        const ok = this.gameScene()?.teleport?.(x, y);
        return say(ok ? `Teleported to ${x}, ${y}.` : "Can't teleport there."), true;
      }
      default:
        return false;
    }
  }

  // ── Mobile controls (canvas) ──────────────────────────────────────
  private buildMobileControls() {
    const coarse =
      (typeof window !== "undefined" &&
        !!window.matchMedia?.("(pointer: coarse)").matches) ||
      (navigator?.maxTouchPoints ?? 0) > 0;
    if (!coarse) return;

    const GAP = 58;
    const clusterX = 96;
    const clusterDY = -156;

    const dpad = (ox: number, oy: number, frame: string, dx: number, dy: number) => {
      const SIZE = 64;
      const bg = this.add
        .image(0, 0, "mc", frame)
        .setDisplaySize(SIZE, SIZE)
        .setAlpha(0.92)
        .setDepth(70)
        .setInteractive();
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
      this.mobileReflow.push((_w, h) =>
        bg.setPosition(clusterX + ox, h + clusterDY + oy),
      );
    };
    dpad(0, -GAP, "dpad_element_north", 0, -1);
    dpad(0, GAP, "dpad_element_south", 0, 1);
    dpad(-GAP, 0, "dpad_element_west", -1, 0);
    dpad(GAP, 0, "dpad_element_east", 1, 0);

    this.touchActionButton(-70, -150, "icon_hand", () =>
      this.gameScene()?.mobileInteract?.(),
    );
    this.touchActionButton(-150, -110, "icon_talk", () => {
      if (!this.isDialogueOpen) this.openChat();
    });

    const run = () =>
      this.mobileReflow.forEach((f) => f(this.scale.width, this.scale.height));
    run();
    this.scale.on("resize", run);
    this.events.once("shutdown", () => this.scale.off("resize", run));
  }

  private touchActionButton(
    rx: number,
    ry: number,
    iconFrame: string,
    onTap: () => void,
  ) {
    const bg = this.add
      .image(0, 0, "mc", "button_circle")
      .setDisplaySize(64, 64)
      .setAlpha(0.92)
      .setDepth(70)
      .setInteractive();
    const icon = this.add
      .image(0, 0, "mc-icons", iconFrame)
      .setDisplaySize(34, 34)
      .setDepth(71);
    bg.on("pointerdown", () => {
      bg.setTint(0xffd166);
      icon.setTint(0x333333);
    });
    bg.on("pointerup", () => {
      bg.clearTint();
      icon.clearTint();
      onTap();
      playUiSound(this, "sfx-tap", 0.3);
    });
    bg.on("pointerout", () => {
      bg.clearTint();
      icon.clearTint();
    });
    this.mobileReflow.push((w, h) => {
      bg.setPosition(w + rx, h + ry);
      icon.setPosition(w + rx, h + ry);
    });
  }

  // ── Day/night ─────────────────────────────────────────────────────
  setDayCycle(tNow: number, dayLengthMs: number, _serverNow: number) {
    this.dayLengthMs = dayLengthMs;
    this.dayEpoch = Date.now() - tNow * dayLengthMs;
  }

  // Scenes that should hide the DOM HUD chrome while open. DOM modals already
  // cover it, but the canvas ones (InvitePanel/SkinEditor/MapEditor) render
  // below the HUD layer, so without this the chrome would float over them.
  private static readonly MODAL_SCENES = [
    "PauseScene",
    "SettingsScene",
    "ShopScene",
    "InventoryScene",
    "InboxScene",
    "InvitePanelScene",
    "AdminScene",
    "ProjectsScene",
    "SkinEditorScene",
    "MapEditorScene",
    "CharacterScene",
  ];

  private syncHudVisibility() {
    if (!this.hudRoot) return;
    const blocked = UIScene.MODAL_SCENES.some((k) => this.scene.isActive(k));
    this.hudRoot.style.display = blocked ? "none" : "";
  }

  update() {
    this.syncHudVisibility();
    musicEngine.setEnabled(loadSettings().soundEnabled);

    if (this.dayLengthMs <= 0 || !this.nightOverlay) return;
    const phase = this.dayPhase();
    const brightness = (1 - Math.cos(2 * Math.PI * phase)) / 2;
    const darkness = (1 - brightness) * 0.55;
    this.nightOverlay.setAlpha(darkness);

    const mins = Math.floor(phase * 1440);
    const hh = String(Math.floor(mins / 60)).padStart(2, "0");
    const mm = String(mins % 60).padStart(2, "0");
    const clock = `${hh}:${mm}`;
    const dayLabel = phase >= 0.25 && phase < 0.75 ? "day" : "night";
    if (clock !== this.lastClock || dayLabel !== this.lastTimeLabel) {
      this.lastClock = clock;
      this.lastTimeLabel = dayLabel;
      if (this.elClock)
        this.elClock.textContent = `${dayLabel === "day" ? "☀" : "🌙"} ${clock}`;
    }
  }

  // ── Status / coords / hearts / wallet ─────────────────────────────
  setStatus(text: string) {
    if (!this.elStatus) return;
    this.elStatus.textContent = text;
    this.elStatus.classList.toggle("hidden", text.length === 0);
  }

  private lastCx = NaN;
  private lastCy = NaN;
  setCoords(cx: number, cy: number) {
    if (cx === this.lastCx && cy === this.lastCy) return;
    this.lastCx = cx;
    this.lastCy = cy;
    if (this.elCoords) this.elCoords.textContent = `X ${cx}  Y ${cy}`;
  }

  setHp(hp: number, hpMax?: number) {
    if (hpMax !== undefined) this.hpMax = hpMax;
    this.hp = hp;
    this.refreshHearts();
  }

  private refreshHearts() {
    if (!this.elHearts) return;
    this.elHearts.replaceChildren();
    for (let i = 0; i < this.hpMax; i++) {
      const h = el("span", i < this.hp ? "on" : undefined, "♥");
      this.elHearts.append(h);
    }
  }

  get walletTotal(): number {
    return this.pixels;
  }

  setWallet(pixels: number, delta: number) {
    this.pixels = pixels;
    if (!this.elPixels) return;
    this.elPixels.textContent = `🪙 ${this.pixels}`;
    if (delta > 0) {
      this.elPixels.classList.remove("bump");
      // reflow to restart the animation
      void this.elPixels.offsetWidth;
      this.elPixels.classList.add("bump");
    }
  }

  // ── Dialogue passthrough ──────────────────────────────────────────
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

  // ── Chat passthrough ──────────────────────────────────────────────
  get isChatOpen(): boolean {
    return this.chat?.isOpen ?? false;
  }
  openChat() {
    this.chat?.open();
  }
  addChatMessage(msg: ChatMessage) {
    this.chat?.addMessage(msg);
  }
}
