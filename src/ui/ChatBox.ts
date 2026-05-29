import Phaser from "phaser";
import { gameSocket } from "../network/socket";
import { FONT_NARROW, COLORS } from "./theme";
import { playUiSound } from "./UIKit";
import type { ChatMessage } from "../types/network";

// "/me waves" → an action line instead of a normal "Name: text" line.
export function formatChatBubble(text: string): string {
  return text.startsWith("/me ") ? text.slice(4) : text;
}

const MAX_LINES = 7;
const LINE_TTL = 11000; // ms a line stays before fading when chat is closed
const LINE_H = 18;

// Bottom-left world chat: a fading scrollback log plus a DOM <input> that
// appears when the player presses Enter / T. Lives inside the UIScene.
export class ChatBox {
  private scene: Phaser.Scene;
  private lines: { text: Phaser.GameObjects.Text; fade?: Phaser.Time.TimerEvent }[] = [];
  private dom: Phaser.GameObjects.DOMElement;
  private inputEl: HTMLInputElement;
  private hint: Phaser.GameObjects.Text;
  private active = false;
  private unread = 0;
  private readonly x = 14;
  private readonly inputY: number;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.inputY = scene.scale.height - 16;

    this.hint = scene.add
      .text(this.x, this.inputY - 2, "Press  Enter  to chat", {
        fontFamily: FONT_NARROW,
        fontSize: "12px",
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
      width: "380px",
      padding: "7px 10px",
      font: '14px "Kenney Future Narrow", monospace',
      color: "#ffffff",
      background: "rgba(10,15,28,0.88)",
      border: "2px solid #ffd166",
      borderRadius: "6px",
      outline: "none",
    } as Partial<CSSStyleDeclaration>);
    this.dom.setVisible(false);

    // Keep keystrokes from leaking to Phaser (which would move the player or
    // trigger hotkeys while the player is typing).
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
    this.inputEl.focus();
    // While typing, keep the whole log fully visible.
    for (const l of this.lines) {
      l.fade?.remove();
      l.fade = undefined;
      l.text.setAlpha(1);
    }
  }

  // Reflect the unread count on the closed-chat hint.
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
    this.hint.setVisible(true);
    this.inputEl.blur();
    // Restart the fade countdown on existing lines.
    for (const l of this.lines) this.scheduleFade(l);
  }

  private submit() {
    const text = this.inputEl.value.trim();
    if (text) gameSocket.sendChat(text);
    this.inputEl.value = "";
    this.close();
  }

  addMessage(msg: ChatMessage) {
    const mine = msg.id === gameSocket.id;
    const action = msg.text.startsWith("/me ");
    const display = action
      ? `✦ ${msg.name} ${msg.text.slice(4)}`
      : `${msg.name}: ${msg.text}`;
    const color = action ? COLORS.good : mine ? COLORS.accent : COLORS.text;

    const text = this.scene.add
      .text(this.x, 0, display, {
        fontFamily: FONT_NARROW,
        fontSize: "13px",
        color,
        stroke: "#000000",
        strokeThickness: 3,
        wordWrap: { width: 460 },
      })
      .setOrigin(0, 1)
      .setResolution(3)
      .setScrollFactor(0);

    const line = { text } as { text: Phaser.GameObjects.Text; fade?: Phaser.Time.TimerEvent };
    this.lines.push(line);
    while (this.lines.length > MAX_LINES) {
      const old = this.lines.shift()!;
      old.fade?.remove();
      old.text.destroy();
    }
    this.reflow();
    if (this.active) {
      line.text.setAlpha(1);
    } else {
      this.scheduleFade(line);
      // Incoming chatter while closed: blip + bump the unread badge.
      if (!mine) {
        this.unread++;
        this.updateHint();
        playUiSound(this.scene, "sfx-tap", 0.25);
      }
    }
  }

  private scheduleFade(line: { text: Phaser.GameObjects.Text; fade?: Phaser.Time.TimerEvent }) {
    line.fade?.remove();
    line.text.setAlpha(1);
    line.fade = this.scene.time.delayedCall(LINE_TTL, () => {
      this.scene.tweens.add({ targets: line.text, alpha: 0.0, duration: 600 });
    });
  }

  // Stack lines upward from just above the input.
  private reflow() {
    const baseY = this.inputY - 34;
    for (let i = 0; i < this.lines.length; i++) {
      const fromBottom = this.lines.length - 1 - i;
      this.lines[i].text.setY(baseY - fromBottom * LINE_H);
    }
  }
}
