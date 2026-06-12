import Phaser from "phaser";
import { gameSocket } from "../network/socket";
import { FONT, COLORS } from "./theme";
import { playUiSound } from "./UIKit";
import type { ChatMessage } from "../types/network";

export function formatChatBubble(text: string): string {
  return text.startsWith("/me ") ? text.slice(4) : text;
}

const MAX_LINES = 9;
const LINE_TTL = 11000;
const LINE_GAP = 4;

const CHAT_FONT = FONT;

export class ChatBox {
  private scene: Phaser.Scene;
  private lines: {
    text: Phaser.GameObjects.Text;
    bg: Phaser.GameObjects.Rectangle;
    fade?: Phaser.Time.TimerEvent;
  }[] = [];
  private dom: Phaser.GameObjects.DOMElement;
  private inputEl: HTMLInputElement;
  private hint: Phaser.GameObjects.Text;
  private active = false;
  private unread = 0;
  private readonly x = 12;
  private inputY: number;

  onCommand?: (raw: string) => boolean;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.inputY = scene.scale.height - 16;

    this.hint = scene.add
      .text(this.x, this.inputY - 2, "Press  Enter  to chat", {
        fontFamily: CHAT_FONT,
        fontSize: "13px",
        color: COLORS.textDim,
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0, 1)
      .setResolution(3)
      .setAlpha(0.55)
      .setScrollFactor(0);

    this.dom = scene.add
      .dom(this.x, this.inputY, "input")
      .setOrigin(0, 1)
      .setScrollFactor(0);
    this.inputEl = this.dom.node as HTMLInputElement;
    this.inputEl.type = "text";
    this.inputEl.maxLength = 160;
    this.inputEl.placeholder = "Say something…";
    Object.assign(this.inputEl.style, {
      width: `${this.inputWidth()}px`,
      padding: "7px 10px",
      font: `15px ${CHAT_FONT}`,
      color: "#f4e3c2",
      background: "rgba(26,17,10,0.55)",
      border: "2px solid #5a4632",
      borderRadius: "0",
      outline: "none",
    } as Partial<CSSStyleDeclaration>);
    this.dom.setVisible(false);
    this.inputEl.style.display = "none";

    this.inputEl.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        this.submit();
      } else if (e.key === "Escape") {
        this.close();
      }
    });
    this.inputEl.addEventListener("blur", () => {
      if (this.active) this.close();
    });
  }

  get isOpen(): boolean {
    return this.active;
  }

  open() {
    if (this.active) return;
    this.active = true;
    this.unread = 0;
    this.updateHint();
    this.dom.setVisible(true);
    this.hint.setVisible(false);
    this.inputEl.value = "";

    this.inputEl.style.display = "block";
    this.inputEl.focus();

    for (const l of this.lines) {
      l.fade?.remove();
      l.fade = undefined;
      this.setLineAlpha(l, 1);
    }
  }

  private updateHint() {
    if (this.unread > 0) {
      this.hint
        .setText(`Press  Enter  to chat  (${this.unread} new)`)
        .setColor(COLORS.accent)
        .setAlpha(0.95);
    } else {
      this.hint
        .setText("Press  Enter  to chat")
        .setColor(COLORS.textDim)
        .setAlpha(0.55);
    }
  }

  close() {
    if (!this.active) return;
    this.active = false;
    this.dom.setVisible(false);
    this.inputEl.style.display = "none";
    this.hint.setVisible(true);
    this.inputEl.blur();

    for (const l of this.lines) this.scheduleFade(l);
  }

  private submit() {
    const text = this.inputEl.value.trim();
    if (text) {
      if (!(text.startsWith("/") && this.onCommand?.(text))) {
        const sent = gameSocket.sendChat(text);
        if (!sent)
          this.flashHint("Offline — message will send when you reconnect");
      }
    }
    this.inputEl.value = "";
    this.close();
  }

  addSystem(text: string) {
    this.addMessage({ id: "__system__", name: "", text: `§ ${text}` });
  }

  private flashHint(msg: string) {
    this.hint.setText(msg).setColor(COLORS.accent).setAlpha(0.95);
    this.scene.time.delayedCall(3500, () => {
      if (!this.active) this.updateHint();
    });
  }

  addMessage(msg: ChatMessage) {
    const mine = msg.id === gameSocket.id;
    const system = msg.id === "__system__";
    const action = msg.text.startsWith("/me ");
    const display = system
      ? msg.text.replace(/^§ /, "")
      : action
        ? `✦ ${msg.name} ${msg.text.slice(4)}`
        : `${msg.name}: ${msg.text}`;

    const color = system ? COLORS.accent : action ? COLORS.good : COLORS.text;

    const text = this.scene.add
      .text(this.x, 0, display, {
        fontFamily: CHAT_FONT,
        fontSize: "15px",
        color,
        stroke: "#000000",
        strokeThickness: 3,
        wordWrap: { width: 460 },
      })
      .setOrigin(0, 1)
      .setResolution(3)
      .setScrollFactor(0);

    const bg = this.scene.add
      .rectangle(this.x - 4, 0, text.width + 8, text.height + 2, 0x000000, 0.6)
      .setStrokeStyle(1, 0xffffff, 0.1)
      .setOrigin(0, 1)
      .setScrollFactor(0);

    bg.setDepth(text.depth - 1);

    const line = { text, bg } as {
      text: Phaser.GameObjects.Text;
      bg: Phaser.GameObjects.Rectangle;
      fade?: Phaser.Time.TimerEvent;
    };
    this.lines.push(line);
    while (this.lines.length > MAX_LINES) {
      const old = this.lines.shift()!;
      old.fade?.remove();
      old.text.destroy();
      old.bg.destroy();
    }
    this.reflow();
    if (this.active) {
      this.setLineAlpha(line, 1);
    } else {
      this.scheduleFade(line);

      if (!mine) {
        this.unread++;
        this.updateHint();
        playUiSound(this.scene, "sfx-tap", 0.25);
      }
    }
  }

  private setLineAlpha(
    line: { text: Phaser.GameObjects.Text; bg: Phaser.GameObjects.Rectangle },
    a: number,
  ) {
    line.text.setAlpha(a);
    line.bg.setAlpha(a);
  }

  private scheduleFade(line: {
    text: Phaser.GameObjects.Text;
    bg: Phaser.GameObjects.Rectangle;
    fade?: Phaser.Time.TimerEvent;
  }) {
    line.fade?.remove();
    this.setLineAlpha(line, 1);
    line.fade = this.scene.time.delayedCall(LINE_TTL, () => {
      this.scene.tweens.add({
        targets: [line.text, line.bg],
        alpha: 0,
        duration: 600,
      });
    });
  }

  private inputWidth(): number {
    return Math.min(440, this.scene.scale.width - this.x * 2);
  }

  relayout() {
    this.inputY = this.scene.scale.height - 16;
    this.inputEl.style.width = `${this.inputWidth()}px`;
    this.hint.setY(this.inputY - 2);
    this.dom.setY(this.inputY);
    this.reflow();
  }

  private reflow() {
    let bottom = this.inputY - 34;
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const line = this.lines[i];
      line.text.setY(bottom);
      line.bg.setY(bottom + 1);
      bottom -= line.text.height + LINE_GAP;
    }
  }
}
