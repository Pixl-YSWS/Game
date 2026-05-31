import Phaser from "phaser";
import { gameSocket } from "../network/socket";
import { COLORS } from "./theme";
import { playUiSound } from "./UIKit";
import type { ChatMessage } from "../types/network";

// "/me waves" → an action line instead of a normal "Name: text" line.
export function formatChatBubble(text: string): string {
  return text.startsWith("/me ") ? text.slice(4) : text;
}

const MAX_LINES = 9;
const LINE_TTL = 11000; // ms a line stays before fading when chat is closed
const LINE_GAP = 4; // vertical gap between stacked chat lines
// Monocraft — a Minecraft look-alike that reads like a real MC chat log, far
// easier on the eyes at small sizes than the blocky all-caps UI font. Falls
// back to Pixelify Sans until Monocraft.ttf is dropped into public/assets/fonts.
const CHAT_FONT = '"Monocraft", "Pixelify Sans", "Trebuchet MS", sans-serif';

// Bottom-left world chat, styled after Minecraft: each line sits on its own
// translucent dark strip so it stays legible over any background, with a DOM
// <input> bar that appears when the player presses Enter / T. Lives inside the
// UIScene.
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
  // Optional slash-command interceptor. Returns true if it handled the line
  // (so it is NOT sent to the server as chat). Set by UIScene.
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
      color: "#ffffff",
      background: "rgba(0,0,0,0.55)",
      border: "1px solid rgba(255,255,255,0.25)",
      borderRadius: "0",
      outline: "none",
    } as Partial<CSSStyleDeclaration>);
    this.dom.setVisible(false);
    this.inputEl.style.display = "none";

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
    // Phaser only flips the DOM node to `display:block` during its next render
    // pass, and focus() is a no-op on a `display:none` element — so reveal it
    // now (matching what the renderer will do anyway) before focusing,
    // otherwise the field opens unfocused and the player has to click it.
    this.inputEl.style.display = "block";
    this.inputEl.focus();
    // While typing, keep the whole log fully visible.
    for (const l of this.lines) {
      l.fade?.remove();
      l.fade = undefined;
      this.setLineAlpha(l, 1);
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
    this.inputEl.style.display = "none";
    this.hint.setVisible(true);
    this.inputEl.blur();
    // Restart the fade countdown on existing lines.
    for (const l of this.lines) this.scheduleFade(l);
  }

  private submit() {
    const text = this.inputEl.value.trim();
    if (text) {
      // Slash-commands are handled locally and never broadcast as chat.
      if (!(text.startsWith("/") && this.onCommand?.(text))) {
        const sent = gameSocket.sendChat(text);
        if (!sent) this.flashHint("Offline — message will send when you reconnect");
      }
    }
    this.inputEl.value = "";
    this.close();
  }

  // A local-only system line (command feedback, etc.) — not sent anywhere.
  addSystem(text: string) {
    this.addMessage({ id: "__system__", name: "", text: `§ ${text}` });
  }

  // Briefly override the closed-chat hint (used to confirm a queued message).
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
    // White chat for legibility; /me actions green; system feedback amber.
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

    // Minecraft-style translucent strip behind the line, with a faint outline
    // so each message stays separated from the world (and its neighbours).
    // Added before the text is referenced for layout; drawn behind it.
    const bg = this.scene.add
      .rectangle(this.x - 4, 0, text.width + 8, text.height + 2, 0x000000, 0.6)
      .setStrokeStyle(1, 0xffffff, 0.1)
      .setOrigin(0, 1)
      .setScrollFactor(0);
    // Keep the strip behind the glyphs.
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
      // Incoming chatter while closed: blip + bump the unread badge.
      if (!mine) {
        this.unread++;
        this.updateHint();
        playUiSound(this.scene, "sfx-tap", 0.25);
      }
    }
  }

  // Set both the text and its backing strip alpha together (the strip stays a
  // touch more transparent than the text).
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

  // Chat input width, capped to the viewport so it never runs off-screen on
  // narrow windows (and shrinks with the canvas under the RESIZE scale mode).
  private inputWidth(): number {
    return Math.min(440, this.scene.scale.width - this.x * 2);
  }

  // Re-anchor to the bottom-left after a canvas resize (window drag /
  // fullscreen toggle): the input width and every line's Y depend on the
  // current viewport size.
  relayout() {
    this.inputY = this.scene.scale.height - 16;
    this.inputEl.style.width = `${this.inputWidth()}px`;
    this.hint.setY(this.inputY - 2);
    this.dom.setY(this.inputY);
    this.reflow();
  }

  // Stack lines upward from just above the input. Each line is offset by its
  // own measured height (not a fixed step), so a wrapped multi-line message
  // pushes the ones above it up instead of overlapping them.
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
