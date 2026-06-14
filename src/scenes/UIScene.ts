import Phaser from "phaser";
import { DialogueBox } from "../ui/DialogueBox";
import { ChatBox } from "../ui/ChatBox";
import { COLORS, CURSORS, EMOTE_ATLAS } from "../ui/theme";
import { playUiSound } from "../ui/UIKit";
import { el, openDomModal, type DomModal } from "../ui/dom";
import { EMOTES, QUICK_EMOTES } from "../ui/emotes";
import { gameSocket } from "../network/socket";
import { getAccountId, getAccountName } from "../network/playerIdentity";
import { loadSettings, getKeybinds } from "../data/Settings";
import { musicEngine } from "../audio/MusicEngine";
import { voiceChat } from "../audio/VoiceChat";
import { eventToKeyName, prettyKey } from "./SettingsScene";
import type { ChatMessage, PlayerDirEntry, ModRole } from "../types/network";

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
  --hud-scale: 1;
}
/* Each cluster scales from its own anchored corner so it stays put. */
#pixl-hud .hud-topleft { transform: scale(var(--hud-scale)); transform-origin: top left; }
#pixl-hud .hud-topright { transform: scale(var(--hud-scale)); transform-origin: top right; }
#pixl-hud .hud-coords { transform: scale(var(--hud-scale)); transform-origin: bottom left; }
#pixl-hud .hud-bottomright { transform: scale(var(--hud-scale)); transform-origin: bottom right; }
#pixl-hud .hud-dpad { transform: scale(var(--hud-scale)); transform-origin: bottom left; }
#pixl-hud .hud-touchactions { transform: scale(var(--hud-scale)); transform-origin: bottom right; }
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
  position: absolute; top: 12px; left: 50%;
  transform: translateX(-50%) scale(var(--hud-scale)); transform-origin: top center;
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
#pixl-hud .tip {
  position: absolute; left: 50%; transform: translateX(-50%);
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
#pixl-hud .hud-iconbtn .tip { top: 52px; }
/* Emote bar + voice (bottom-right cluster) */
#pixl-hud .hud-bottomright {
  position: absolute; right: 12px; bottom: 12px;
  display: flex; align-items: flex-end; gap: 8px;
}
#pixl-hud .hud-emotebar { display: flex; gap: 4px; padding: 7px; }
#pixl-hud .hud-emote {
  pointer-events: auto; cursor: ${CURSORS.pointer};
  width: 34px; height: 34px; padding: 0; border: none; background: none;
  display: flex; align-items: center; justify-content: center;
}
#pixl-hud .hud-emote img { width: 28px; height: 28px; image-rendering: pixelated; transition: transform 0.08s; }
#pixl-hud .hud-emote:hover img { transform: scale(1.25); }
#pixl-hud .hud-more {
  pointer-events: auto; cursor: ${CURSORS.pointer};
  width: 34px; height: 34px; font-size: 15px; color: #f4e3c2;
}
#pixl-hud .hud-more:hover { background: #46301c; }
#pixl-hud .hud-emotepop {
  position: absolute; right: 0; bottom: 100%; margin-bottom: 8px;
  display: grid; grid-template-columns: repeat(5, 40px); gap: 4px; padding: 10px;
}
#pixl-hud .hud-emotepop .hud-emote { width: 40px; height: 40px; }
#pixl-hud .hud-emotepop .hud-emote img { width: 32px; height: 32px; }
#pixl-hud .hud-voicebtn {
  pointer-events: auto; cursor: ${CURSORS.pointer}; position: relative;
  width: 48px; height: 48px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
}
#pixl-hud .hud-voicebtn img { width: 26px; height: 26px; image-rendering: pixelated; }
#pixl-hud .hud-voicebtn.on { background: #7a2b2b; }
#pixl-hud .hud-voicebtn .tip { bottom: 54px; }
#pixl-hud .hud-voicebtn:hover .tip { opacity: 1; }
/* Mobile touch controls */
#pixl-hud .hud-dpad {
  position: absolute; left: 24px; bottom: 96px;
  display: grid; grid-template-columns: repeat(3, 56px); grid-template-rows: repeat(3, 56px);
}
#pixl-hud .hud-dbtn {
  pointer-events: auto; cursor: pointer; padding: 0; border: none; background: none;
  touch-action: none; -webkit-tap-highlight-color: transparent;
}
#pixl-hud .hud-dbtn img { width: 56px; height: 56px; image-rendering: pixelated; }
#pixl-hud .hud-dbtn.press img { filter: brightness(1.4) saturate(1.4); }
#pixl-hud .hud-dbtn.up { grid-area: 1 / 2; }
#pixl-hud .hud-dbtn.left { grid-area: 2 / 1; }
#pixl-hud .hud-dbtn.right { grid-area: 2 / 3; }
#pixl-hud .hud-dbtn.down { grid-area: 3 / 2; }
#pixl-hud .hud-touchactions {
  position: absolute; right: 96px; bottom: 116px;
  display: flex; flex-direction: column; gap: 14px;
}
#pixl-hud .hud-actbtn {
  pointer-events: auto; cursor: pointer; touch-action: none;
  width: 64px; height: 64px; border-radius: 50%;
  background: #2b1d12cc; border: 3px solid #17100a;
  display: flex; align-items: center; justify-content: center;
}
#pixl-hud .hud-actbtn img { width: 34px; height: 34px; image-rendering: pixelated; }
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

  // ── Emote bar / voice / mobile (DOM) ──────────────────────────────
  private bottomRight?: HTMLDivElement;
  private elEmotePop?: HTMLDivElement;
  private emotePopupOpen = false;
  private elVoice?: HTMLButtonElement;
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
  // Only the night tint (canvas) and chat need repositioning now — the rest of
  // the HUD is DOM and anchored by CSS.
  private layout = (gameSize: Phaser.Structs.Size) => {
    this.nightOverlay?.setSize(gameSize.width, gameSize.height);
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
    const invite = this.iconButton("💌", "Invite  [I]", () =>
      world()?.openInvitePanel(),
    );
    const bag = this.iconButton("🎒", "Bag  [B]", () => world()?.openInventory());
    const inbox = this.iconButton("📬", "Inbox  [N]", () =>
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
    this.applyHudScale();
  }

  private lastHudScale = -1;
  private applyHudScale() {
    const s = loadSettings().hudScale;
    if (s === this.lastHudScale) return;
    this.lastHudScale = s;
    this.hudRoot?.style.setProperty("--hud-scale", String(s));
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

  // ── Emote bar (DOM) ───────────────────────────────────────────────
  private frameImg(atlas: string, frame: string, px: number): HTMLImageElement {
    const img = document.createElement("img");
    img.src = this.textures.getBase64(atlas, frame);
    img.width = px;
    img.height = px;
    img.style.imageRendering = "pixelated";
    return img;
  }

  private emoteCell(
    frame: string,
    onClick: () => void,
    px = 28,
  ): HTMLButtonElement {
    const cell = el("button", "hud-emote");
    cell.type = "button";
    cell.append(this.frameImg(EMOTE_ATLAS, frame, px));
    cell.addEventListener("click", onClick);
    return cell;
  }

  private buildEmoteBar() {
    if (!this.hudRoot) return;
    const cluster = el("div", "hud-bottomright");
    this.bottomRight = cluster;

    const bar = el("div", "hud-emotebar hud-panel");
    for (const e of QUICK_EMOTES)
      bar.append(this.emoteCell(e.frame, () => this.sendEmote(e.key)));
    const more = el("button", "hud-more");
    more.type = "button";
    more.textContent = "•••";
    more.addEventListener("click", () => {
      playUiSound(this, "sfx-tap", 0.3);
      this.toggleEmotePopup();
    });
    bar.append(more);
    cluster.append(bar);
    this.hudRoot.append(cluster);

    this.input.keyboard?.on("keydown-C", () => {
      if (this.isChatOpen || this.isDialogueOpen) return;
      this.toggleEmotePopup();
    });
  }

  private sendEmote(key: string) {
    gameSocket.sendEmote(key);
    playUiSound(this, "sfx-tap", 0.3);
  }

  private toggleEmotePopup() {
    if (this.emotePopupOpen) {
      this.elEmotePop?.remove();
      this.elEmotePop = undefined;
      this.emotePopupOpen = false;
      return;
    }
    if (!this.bottomRight) return;
    const pop = el("div", "hud-emotepop hud-panel");
    for (const e of EMOTES)
      pop.append(
        this.emoteCell(
          e.frame,
          () => {
            this.sendEmote(e.key);
            this.toggleEmotePopup();
          },
          32,
        ),
      );
    this.bottomRight.append(pop);
    this.elEmotePop = pop;
    this.emotePopupOpen = true;
  }

  // ── Voice button (DOM) ────────────────────────────────────────────
  private buildVoiceButton() {
    if (!voiceChat.supported || !this.bottomRight) return;
    voiceChat.setSender((data, mime) => gameSocket.sendVoiceClip(data, mime));
    voiceChat.onStateChange((on) => this.setMicActive(on));

    const btn = el("button", "hud-voicebtn hud-panel");
    btn.type = "button";
    btn.append(this.frameImg("mc-icons", "icon_microphone", 26));
    const tip = el("span", "tip", `Mic  [${prettyKey(getKeybinds().talk)}]`);
    btn.append(tip);
    btn.addEventListener("pointerenter", () => {
      tip.textContent = `Mic  [${prettyKey(getKeybinds().talk)}]`;
    });
    btn.addEventListener("click", () => this.toggleMic());
    this.elVoice = btn;
    // Sit to the left of the emote bar.
    this.bottomRight.prepend(btn);

    this.input.keyboard?.on("keydown", (e: KeyboardEvent) => {
      if (e.repeat || this.isChatOpen || this.isDialogueOpen) return;
      if (!this.gameScene()) return;
      if (eventToKeyName(e) === getKeybinds().talk) this.toggleMic();
    });
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
    this.elVoice?.classList.toggle("on", on);
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

  // ── Mobile controls (DOM) ─────────────────────────────────────────
  private buildMobileControls() {
    const coarse =
      (typeof window !== "undefined" &&
        !!window.matchMedia?.("(pointer: coarse)").matches) ||
      (navigator?.maxTouchPoints ?? 0) > 0;
    if (!coarse || !this.hudRoot) return;

    const dpad = el("div", "hud-dpad");
    const dbtn = (
      cls: string,
      frame: string,
      dx: number,
      dy: number,
    ): HTMLButtonElement => {
      const b = el("button", `hud-dbtn ${cls}`);
      b.type = "button";
      b.append(this.frameImg("mc", frame, 56));
      const press = (ev: PointerEvent) => {
        ev.preventDefault();
        b.classList.add("press");
        this.gameScene()?.setTouchDir(dx, dy);
      };
      const release = () => {
        b.classList.remove("press");
        this.gameScene()?.setTouchDir(0, 0);
      };
      b.addEventListener("pointerdown", press);
      b.addEventListener("pointerup", release);
      b.addEventListener("pointerleave", release);
      b.addEventListener("pointercancel", release);
      return b;
    };
    dpad.append(
      dbtn("up", "dpad_element_north", 0, -1),
      dbtn("left", "dpad_element_west", -1, 0),
      dbtn("right", "dpad_element_east", 1, 0),
      dbtn("down", "dpad_element_south", 0, 1),
    );
    this.hudRoot.append(dpad);

    const actions = el("div", "hud-touchactions");
    const actBtn = (frame: string, onTap: () => void): HTMLButtonElement => {
      const b = el("button", "hud-actbtn");
      b.type = "button";
      b.append(this.frameImg("mc-icons", frame, 34));
      b.addEventListener("click", () => {
        onTap();
        playUiSound(this, "sfx-tap", 0.3);
      });
      return b;
    };
    actions.append(
      actBtn("icon_hand", () => this.gameScene()?.mobileInteract?.()),
      actBtn("icon_talk", () => {
        if (!this.isDialogueOpen) this.openChat();
      }),
    );
    this.hudRoot.append(actions);
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
    this.applyHudScale();
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
