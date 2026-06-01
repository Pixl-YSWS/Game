import Phaser from "phaser";
import { DialogueBox } from "../ui/DialogueBox";
import { ChatBox } from "../ui/ChatBox";
import { FONT, FONT_EMOJI, FONT_CHAT, FONT_TITLE, COLORS, CURSORS, EMOTE_ATLAS } from "../ui/theme";
import { panel, playUiSound, uiNineslice, uiImage } from "../ui/UIKit";
import { EMOTES, QUICK_EMOTES } from "../ui/emotes";
import { gameSocket } from "../network/socket";
import { getAccountId } from "../network/playerIdentity";
import { loadSettings, getKeybinds } from "../data/Settings";
import { musicEngine } from "../audio/MusicEngine";
import { voiceChat } from "../audio/VoiceChat";
import { eventToKeyName, prettyKey } from "./SettingsScene";
import type { ChatMessage, PlayerDirEntry, ModRole } from "../types/network";


type Movable = Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform;



type GameplayScene = Phaser.Scene & {
  setTouchDir(dx: number, dy: number): void;
  mobileInteract?: () => void;
  setSpeedMultiplier?: (mul: number) => void;
  teleport?: (cx: number, cy: number) => boolean;
  showSpeaking?: (id: string) => void;
};




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
  
  private unread = 0;
  private badgeBg?: Phaser.GameObjects.Arc;
  private badgeText?: Phaser.GameObjects.Text;

  
  private playerListOpen = false;
  private latestPlayers: PlayerDirEntry[] = [];
  private playerListObjects: Phaser.GameObjects.GameObject[] = [];

  
  
  
  
  
  
  private readonly ICON_SIZE = 50;
  private readonly ICON_ICON = 23;
  private readonly ICON_GAP = 8;

  private socialObjects: Movable[] = [];
  private emoteObjects: Movable[] = [];
  private socialBaseW = 0;
  private emoteBaseW = 0;
  private emoteBaseH = 0;
  
  private emotePopup?: Phaser.GameObjects.Container;
  private emotePopupOpen = false;
  
  
  private mobileReflow: ((w: number, h: number) => void)[] = [];
  
  private micBtn?: Phaser.GameObjects.Image;
  private micBusy = false;

  
  
  private adminRole: ModRole = null;
  private adminBtn?: { bg: Phaser.GameObjects.NineSlice; icon: Phaser.GameObjects.Text; tooltip: Phaser.GameObjects.Text };

  
  
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

    this.buildPlayerCard();
    this.buildStatusBar();

    this.box = new DialogueBox(this);
    this.chat = new ChatBox(this);
    this.chat.onCommand = (raw) => this.handleChatCommand(raw);
    this.buildEmoteBar();
    this.buildVoiceButton();
    this.buildSocialButtons();
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
    });
  }

  
  
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

  
  private dayPhase(): number {
    if (this.dayLengthMs <= 0) return 0.5;
    const t = (((Date.now() - this.dayEpoch) % this.dayLengthMs) + this.dayLengthMs) % this.dayLengthMs;
    return t / this.dayLengthMs;
  }

  
  private buildPlayerCard() {
    const X = 12, Y = 12, W = 188, H = 62;
    panel(this, X, Y, W, H, "ui-panel-dark").setOrigin(0, 0).setAlpha(0.96);
    const baseX = X + 15;

    
    const heartsY = Y + 13;
    for (let i = 0; i < this.hpMax; i++) {
      const g = this.add.graphics();
      g.x = baseX + i * 13;
      g.y = heartsY;
      this.heartIcons.push(g);
    }
    this.refreshHearts();

    
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

    
    this.coordText = this.add
      .text(X + 2, Y + H + 4, "", { fontFamily: FONT, fontSize: "8px", color: COLORS.textDim })
      .setAlpha(0.5);
  }

  
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

  
  private buildSocialButtons() {
    const world = () => this.scene.get("WorldScene") as
      | (Phaser.Scene & { openInvitePanel: () => void; openInbox: () => void; openInventory: () => void })
      | undefined;

    
    this.socialBaseW = this.scale.width;
    const SIZE = this.ICON_SIZE, GAP = this.ICON_GAP, cy = 12 + SIZE / 2;
    let x = this.scale.width - 12 - SIZE / 2;
    const inboxBtn = this.iconButton(x, cy, "✉", "Inbox  [N]", () => world()?.openInbox());
    x -= SIZE + GAP;
    this.iconButton(x, cy, "🎒", "Bag  [B]", () => world()?.openInventory());
    x -= SIZE + GAP;
    this.iconButton(x, cy, "✦", "Invite  [I]", () => world()?.openInvitePanel());

    
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

  
  private iconButton(cx: number, cy: number, glyph: string, tip: string, onClick: () => void) {
    const SIZE = this.ICON_SIZE;
    const bg = uiNineslice(this, cx, cy, "ui-panel-dark", SIZE, SIZE, 16)
      .setOrigin(0.5)
      .setAlpha(0.96)
      .setDepth(50)
      .setInteractive({ cursor: CURSORS.pointer });
    const icon = this.add
      .text(cx, cy, glyph, { fontFamily: FONT_EMOJI, fontSize: `${this.ICON_ICON}px` })
      .setOrigin(0.5)
      .setDepth(51);
    
    const tooltip = this.add
      .text(cx, cy + SIZE / 2 + 6, tip, {
        fontFamily: FONT,
        fontSize: "12px",
        color: COLORS.text,
        backgroundColor: "#0a0f1ccc",
        padding: { x: 6, y: 4 },
      })
      .setResolution(3)
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

  

  
  
  setAdminRole(role: ModRole) {
    this.adminRole = role;
    if (role && !this.adminBtn) this.buildAdminButton();
    const show = role !== null;
    this.adminBtn?.bg.setVisible(show).setActive(show);
    this.adminBtn?.icon.setVisible(show);
    if (!show) this.adminBtn?.tooltip.setVisible(false);
  }

  
  private buildAdminButton() {
    const SIZE = this.ICON_SIZE, GAP = this.ICON_GAP;
    const x = this.scale.width - 12 - SIZE / 2 - 3 * (SIZE + GAP);
    const cy = 12 + SIZE / 2;
    const bg = uiNineslice(this, x, cy, "ui-panel-dark", SIZE, SIZE, 16)
      .setOrigin(0.5)
      .setAlpha(0.96)
      .setDepth(50)
      .setInteractive({ cursor: CURSORS.pointer });
    const icon = this.add.text(x, cy, "🛡", { fontFamily: FONT_EMOJI, fontSize: `${this.ICON_ICON}px` }).setOrigin(0.5).setDepth(51);
    const tooltip = this.add
      .text(x, cy + SIZE / 2 + 6, "Admin", {
        fontFamily: FONT, fontSize: "12px", color: COLORS.text, backgroundColor: "#0a0f1ccc", padding: { x: 6, y: 4 },
      })
      .setResolution(3)
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

  
  setUnread(n: number) {
    this.unread = Math.max(0, n | 0);
    this.refreshBadge();
  }

  private refreshBadge() {
    const show = this.unread > 0;
    this.badgeBg?.setVisible(show);
    this.badgeText?.setVisible(show).setText(this.unread > 9 ? "9+" : String(this.unread));
  }

  
  
  
  private buildEmoteBar() {
    const cell = 40;
    
    const cells = QUICK_EMOTES.length + 1;
    const w = cells * cell + 16;
    const h = cell + 16;
    const x = this.scale.width - w - 12;
    const y = this.scale.height - h - 12;
    this.emoteBaseW = this.scale.width;
    this.emoteBaseH = this.scale.height;
    const barPanel = panel(this, x, y, w, h, "ui-panel-dark").setOrigin(0, 0).setAlpha(0.95);
    this.emoteObjects.push(barPanel);

    QUICK_EMOTES.forEach((e, i) => {
      const cx = x + 8 + i * cell + cell / 2;
      const cy = y + 8 + cell / 2;
      this.emoteObjects.push(...this.emoteIcon(cx, cy, e.frame, () => this.sendEmote(e.key)));
    });

    
    const ex = x + 8 + QUICK_EMOTES.length * cell + cell / 2;
    const ey = y + 8 + cell / 2;
    const moreBg = uiImage(this, ex, ey, "ui-round")
      .setDisplaySize(cell - 6, cell - 6)
      .setInteractive({ cursor: CURSORS.pointer });
    const moreIcon = this.add
      .text(ex, ey - 1, "•••", { fontFamily: FONT, fontSize: "16px", color: COLORS.text })
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
    const bg = panel(this, x, y, w, h, "ui-panel-dark").setOrigin(0, 0).setAlpha(0.98);
    const title = this.add
      .text(x + w / 2, y + 12, "EMOTES", { fontFamily: FONT_TITLE, fontSize: "12px", color: COLORS.accent })
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
        backgroundColor: "#0a0f1ccc",
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
        loadSettings().voiceEnabled ? "Microphone unavailable." : "Voice is off (Settings).",
      );
    } else {
      this.chat?.addSystem(on ? "Mic on — you're live." : "Mic off.");
    }
  }

  private setMicActive(on: boolean) {
    if (on) this.micBtn?.setTint(0xff6b6b);
    else this.micBtn?.clearTint();
  }

  private onVoice = ({ id, data, mime }: { id: string; data: ArrayBuffer; mime: string }) => {
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
        if (!Number.isFinite(n) || n < 1 || n > 8) return say("Usage: /speed <1-8|reset>"), true;
        this.gameScene()?.setSpeedMultiplier?.(n);
        return say(`Walk speed set to ${n}×.`), true;
      }
      case "tp": {
        if (!isAdmin) return say("You don't have permission to use /tp."), true;
        const x = Number(parts[1]);
        const y = Number(parts[2]);
        if (!Number.isInteger(x) || !Number.isInteger(y)) return say("Usage: /tp <x> <y>"), true;
        const ok = this.gameScene()?.teleport?.(x, y);
        return say(ok ? `Teleported to ${x}, ${y}.` : "Can't teleport there."), true;
      }
      default:
        
        return false;
    }
  }

  
  
  private buildMobileControls() {
    const coarse =
      (typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches) ||
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
      this.mobileReflow.push((_w, h) => bg.setPosition(clusterX + ox, h + clusterDY + oy));
    };
    dpad(0, -GAP, "dpad_element_north", 0, -1);
    dpad(0, GAP, "dpad_element_south", 0, 1);
    dpad(-GAP, 0, "dpad_element_west", -1, 0);
    dpad(GAP, 0, "dpad_element_east", 1, 0);

    
    this.touchActionButton(-70, -150, "icon_hand", () => this.gameScene()?.mobileInteract?.());
    this.touchActionButton(-150, -110, "icon_talk", () => {
      if (!this.isDialogueOpen) this.openChat();
    });

    
    const run = () => this.mobileReflow.forEach((f) => f(this.scale.width, this.scale.height));
    run();
    this.scale.on("resize", run);
    this.events.once("shutdown", () => this.scale.off("resize", run));
  }

  
  
  private touchActionButton(rx: number, ry: number, iconFrame: string, onTap: () => void) {
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

  setDayCycle(tNow: number, dayLengthMs: number, _serverNow: number) {
    this.dayLengthMs = dayLengthMs;
    
    
    this.dayEpoch = Date.now() - tNow * dayLengthMs;
  }

  update() {
    
    
    musicEngine.setEnabled(loadSettings().soundEnabled);

    if (this.dayLengthMs <= 0 || !this.nightOverlay) return;
    const phase = this.dayPhase(); 
    
    const brightness = (1 - Math.cos(2 * Math.PI * phase)) / 2;
    const darkness = (1 - brightness) * 0.55; 
    this.nightOverlay.setAlpha(darkness);

    if (this.timeText) {
      const label = phase < 0.25 ? "Night" : phase < 0.5 ? "Morning" : phase < 0.75 ? "Day" : "Evening";
      
      if (label !== this.lastTimeLabel) {
        this.lastTimeLabel = label;
        this.timeText.setText(label);
        
        this.timeIcon?.setText(phase >= 0.25 && phase < 0.75 ? "☀" : "🌙");
      }
    }
  }

  

  setStatus(text: string) {
    if (!this.statusText) return;
    this.statusText.setText(text);
    
    const show = text.length > 0;
    this.statusText.setVisible(show);
    this.statusBg?.setVisible(show).setSize(this.statusText.width + 26, 24);
  }

  private lastCx = NaN;
  private lastCy = NaN;
  setCoords(cx: number, cy: number) {
    
    
    if (cx === this.lastCx && cy === this.lastCy) return;
    this.lastCx = cx;
    this.lastCy = cy;
    this.coordText?.setText(`X ${cx}  Y ${cy}`);
  }

  setHp(hp: number, hpMax?: number) {
    if (hpMax !== undefined && hpMax !== this.hpMax) {
      
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

  
  
  get walletTotal(): number {
    return this.pixels;
  }

  setWallet(pixels: number, delta: number) {
    this.pixels = pixels;
    
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

  

  get isChatOpen(): boolean {
    return this.chat?.isOpen ?? false;
  }
  openChat() {
    this.chat?.open();
  }
  addChatMessage(msg: ChatMessage) {
    this.chat?.addMessage(msg);
  }

  

  get isPlayerListOpen(): boolean {
    return this.playerListOpen;
  }

  
  
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
    const box = uiNineslice(this, cx, cy, "ui-panel-dark", panelW, panelH, 20)
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
