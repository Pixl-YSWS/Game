import Phaser from "phaser";
import { injectStyles, el } from "./dom";

interface DialogueState {
  speaker: string;
  lines: string[];
  index: number;
}

const STYLE_ID = "pixl-dialogue";

function injectDialogueStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.pixl-dialogue-wrap {
  position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%);
  z-index: 10000;
  display: none;
}
.pixl-dialogue-box {
  position: relative;
  background:
    repeating-conic-gradient(rgba(255, 226, 170, 0.04) 0% 25%, transparent 0% 50%) 0 0 / 6px 6px,
    #2b1d12;
  border: 3px solid #17100a;
  box-shadow: inset 0 0 0 3px #6b4f33, 0 6px 0 #17100a;
  width: min(860px, calc(100vw - 24px));
  padding: 28px 32px 20px;
  font-family: "Monocraft", "Pixelify Sans", monospace;
}
.pixl-dialogue-box::after {
  content: ""; position: absolute; inset: 11px; pointer-events: none;
  background:
    linear-gradient(#d9a440, #d9a440) left top / 10px 10px no-repeat,
    linear-gradient(#d9a440, #d9a440) right top / 10px 10px no-repeat,
    linear-gradient(#d9a440, #d9a440) left bottom / 10px 10px no-repeat,
    linear-gradient(#d9a440, #d9a440) right bottom / 10px 10px no-repeat;
}
.pixl-dialogue-speaker {
  font-family: "Monocraft", "Pixelify Sans", monospace;
  font-size: 18px; color: #ffd166; margin-bottom: 8px;
}
.pixl-dialogue-body {
  font-family: "Monocraft", "Pixelify Sans", monospace;
  font-size: 17px; color: #f4e3c2; line-height: 1.7;
}
.pixl-dialogue-hint {
  font-family: "Monocraft", "Pixelify Sans", monospace;
  font-size: 12px; color: #c9b18c; text-align: right; margin-top: 8px;
}
`;
  document.head.appendChild(style);
}

export class DialogueBox {
  private state?: DialogueState;
  private wrap: HTMLDivElement;
  private speakerEl: HTMLDivElement;
  private bodyEl: HTMLDivElement;
  private hintEl: HTMLDivElement;

  constructor(_scene: Phaser.Scene) {
    injectStyles();
    injectDialogueStyles();

    this.wrap = el("div", "pixl-dialogue-wrap");
    const box = el("div", "pixl-dialogue-box");
    this.speakerEl = el("div", "pixl-dialogue-speaker");
    this.bodyEl = el("div", "pixl-dialogue-body");
    this.hintEl = el("div", "pixl-dialogue-hint", "[E] next");
    box.append(this.speakerEl, this.bodyEl, this.hintEl);
    this.wrap.append(box);
    document.body.append(this.wrap);
  }

  get isOpen(): boolean {
    return this.state !== undefined;
  }

  open(speaker: string, lines: string[]) {
    if (lines.length === 0) return;
    this.state = { speaker, lines, index: 0 };
    this.speakerEl.textContent = speaker;
    this.bodyEl.textContent = lines[0];
    this.hintEl.textContent = lines.length > 1 ? "[E] next" : "[E] close";
    this.wrap.style.display = "block";
  }

  advance(): boolean {
    if (!this.state) return false;
    this.state.index += 1;
    if (this.state.index >= this.state.lines.length) {
      this.close();
      return false;
    }
    const line = this.state.lines[this.state.index];
    this.bodyEl.textContent = line;
    const last = this.state.index === this.state.lines.length - 1;
    this.hintEl.textContent = last ? "[E] close" : "[E] next";
    return true;
  }

  close() {
    this.state = undefined;
    this.wrap.style.display = "none";
  }

  destroy() {
    this.wrap.remove();
  }
}
