import Phaser from "phaser";
import { CURSORS, FONT_EMOJI } from "./theme";
import { playUiSound } from "./UIKit";

const STYLE_ID = "pixl-dom-ui";

export function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.pixl-overlay {
  position: fixed; inset: 0; z-index: 40;
  background: rgba(10, 6, 2, 0.66);
  display: flex; align-items: center; justify-content: center;
  font-family: "Monocraft", "Pixelify Sans", monospace;
  font-size: 15px;
  color: #f4e3c2;
  outline: none;
}
.pixl-overlay ::selection { background: #ffd166; color: #2b1d12; }
.pixl-modal {
  position: relative;
  background:
    repeating-conic-gradient(rgba(255, 226, 170, 0.04) 0% 25%, transparent 0% 50%) 0 0 / 6px 6px,
    #2b1d12;
  border: 3px solid #17100a;
  box-shadow: inset 0 0 0 3px #6b4f33, 10px 10px 0 rgba(0, 0, 0, 0.5);
  width: min(880px, calc(100vw - 28px));
  max-height: calc(100vh - 90px);
  display: flex; flex-direction: column;
  padding: 32px 30px 22px;
}
.pixl-modal::after {
  content: ""; position: absolute; inset: 9px; pointer-events: none;
  background:
    linear-gradient(#d9a440, #d9a440) left top / 8px 8px no-repeat,
    linear-gradient(#d9a440, #d9a440) right top / 8px 8px no-repeat,
    linear-gradient(#d9a440, #d9a440) left bottom / 8px 8px no-repeat,
    linear-gradient(#d9a440, #d9a440) right bottom / 8px 8px no-repeat;
}
.pixl-title {
  font-family: "Pixelify Sans", sans-serif;
  font-weight: 700; font-size: 26px; letter-spacing: 2px;
  text-transform: uppercase;
  color: #2b1d12; text-align: center;
  background: #ffd166;
  border: 3px solid #17100a;
  box-shadow: 0 5px 0 #8c5e1a;
  width: fit-content;
  margin: -54px auto 14px;
  padding: 7px 30px 5px;
  position: relative; z-index: 1;
}
.pixl-close {
  position: absolute; top: -14px; right: -14px; z-index: 1;
  background: #e0604f; border: 3px solid #17100a;
  padding: 6px 11px 4px;
  color: #2b1d12; font-size: 18px; line-height: 1;
  font-family: inherit;
  box-shadow: 0 4px 0 #17100a;
}
.pixl-close:hover { background: #f0775f; }
.pixl-close:active { transform: translateY(4px); box-shadow: none; }
.pixl-sub {
  font-family: "Pixelify Sans", sans-serif;
  text-align: center; font-size: 19px; letter-spacing: 1px;
  color: #ffd166; margin-bottom: 8px;
}
.pixl-body { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.pixl-list { overflow-y: auto; min-height: 0; flex: 1; padding-right: 6px; margin: 8px 0; }
.pixl-list::-webkit-scrollbar, .pixl-check-list::-webkit-scrollbar { width: 12px; }
.pixl-list::-webkit-scrollbar-thumb, .pixl-check-list::-webkit-scrollbar-thumb {
  background: #ffd166; box-shadow: inset 0 0 0 2px #17100a;
}
.pixl-list::-webkit-scrollbar-track, .pixl-check-list::-webkit-scrollbar-track {
  background: #1c1209; box-shadow: inset 0 0 0 2px #17100a;
}
.pixl-row {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px; margin-bottom: 10px;
  background: #3a2817;
  border: 3px solid #17100a;
  box-shadow: inset 0 0 0 2px #5a4632;
}
.pixl-row.pixl-row-link:hover { background: #46301c; box-shadow: inset 0 0 0 2px #ffd166; }
.pixl-row.pixl-row-link:hover .pixl-row-name::before { content: "\\25B6 "; color: #ffd166; }
.pixl-row-main { flex: 1; min-width: 0; }
.pixl-row-name { font-size: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pixl-row-meta { font-size: 13px; color: #c9b18c; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pixl-glyph { font-family: ${FONT_EMOJI}; font-size: 24px; width: 32px; text-align: center; flex-shrink: 0; }
.pixl-btn {
  font-family: inherit;
  font-size: 15px;
  background: #ffd166; color: #3a2410;
  border: 3px solid #17100a;
  padding: 8px 16px 6px;
  box-shadow: 0 4px 0 #17100a, inset -3px -3px 0 #d9a440, inset 3px 3px 0 #ffe7a3;
  white-space: nowrap; flex-shrink: 0;
}
.pixl-btn:hover:not(:disabled) { background: #ffdf8a; }
.pixl-btn:active:not(:disabled) {
  transform: translateY(4px);
  box-shadow: 0 0 0 #17100a, inset -3px -3px 0 #d9a440, inset 3px 3px 0 #ffe7a3;
}
.pixl-btn:focus { outline: 2px solid #ffd166; outline-offset: 2px; }
.pixl-btn.grey:focus { outline-color: #ffd166; }
.pixl-btn:disabled { opacity: 0.5; }
.pixl-btn.grey {
  background: #6e5a41; color: #f4e3c2;
  box-shadow: 0 4px 0 #17100a, inset -3px -3px 0 #54422c, inset 3px 3px 0 #8a7253;
}
.pixl-btn.grey:hover:not(:disabled) { background: #7d6749; }
.pixl-btn.big { font-size: 17px; padding: 11px 24px 9px; }
.pixl-actions { display: flex; gap: 14px; justify-content: center; margin-top: 12px; flex-wrap: wrap; }
.pixl-input {
  font-family: inherit; font-size: 15px;
  background: #2a1d10; color: #f4e3c2;
  border: 3px solid #17100a; padding: 9px 12px 7px;
  box-shadow: inset 2px 2px 0 #17100a;
}
.pixl-input:focus { outline: 2px solid #ffd166; outline-offset: 2px; }
.pixl-input::placeholder { color: #9a835f; }
.pixl-statusline { display: flex; align-items: center; gap: 10px; font-size: 14px; }
.pixl-statusline .pixl-grow { flex: 1; min-width: 0; }
.pixl-toast { min-height: 20px; text-align: center; font-size: 14px; margin-top: 6px; }
.pixl-field { margin-top: 12px; }
.pixl-field label {
  display: block; font-size: 13px; letter-spacing: 0.5px;
  text-transform: uppercase; color: #ffd166; margin-bottom: 5px;
}
.pixl-field input, .pixl-field textarea {
  width: 100%; box-sizing: border-box;
  background: #1c1209;
  border: 3px solid #5a4632;
  color: #f4e3c2; padding: 8px 12px;
  font-family: inherit; font-size: 15px;
  outline: none; resize: none;
  box-shadow: inset 3px 3px 0 rgba(0, 0, 0, 0.45);
}
.pixl-field input:focus, .pixl-field textarea:focus { border-color: #ffd166; }
.pixl-field input::placeholder, .pixl-field textarea::placeholder { color: #7d6a50; }
.pixl-check-list {
  display: flex; flex-direction: column; gap: 6px;
  max-height: 220px; overflow-y: auto; padding-right: 6px; margin-top: 4px;
}
.pixl-check-item {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px;
  background: #3a2817;
  border: 2px solid #5a4632;
}
.pixl-check-item:hover { border-color: #ffd166; }
.pixl-check-item input { width: 16px; height: 16px; accent-color: #ffd166; flex-shrink: 0; }
.pixl-check-item .pixl-grow { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pixl-check-time { font-size: 12.5px; color: #c9b18c; flex-shrink: 0; }
.pixl-check-empty { font-size: 13.5px; color: #c9b18c; text-align: center; padding: 12px; line-height: 1.6; }
.pixl-hint { font-size: 14px; color: #c9b18c; text-align: center; line-height: 1.7; margin: 14px 0; }
.pixl-empty { text-align: center; color: #c9b18c; font-size: 14.5px; line-height: 1.8; padding: 28px 0; }
.pixl-overlay button { cursor: ${CURSORS.pointer}; }
`;
  document.head.appendChild(style);
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export interface DomModalOpts {
  title: string;
  width?: number;
  onClose: () => void;
}

export interface DomModal {
  root: HTMLDivElement;
  modal: HTMLDivElement;
  body: HTMLDivElement;
  
  onEscape: () => void;
  destroy(): void;
}

export function openDomModal(
  scene: Phaser.Scene,
  opts: DomModalOpts,
): DomModal {
  injectStyles();

  const root = el("div", "pixl-overlay");
  root.tabIndex = -1;
  const modal = el("div", "pixl-modal");
  if (opts.width)
    modal.style.width = `min(${opts.width}px, calc(100vw - 28px))`;
  const body = el("div", "pixl-body");

  modal.append(el("div", "pixl-title", opts.title));
  const close = el("button", "pixl-close", "✕");
  close.type = "button";
  close.addEventListener("click", () => {
    playUiSound(scene, "sfx-click");
    opts.onClose();
  });
  modal.append(close, body);
  root.append(modal);
  document.body.append(root);
  root.focus();

  const handle: DomModal = {
    root,
    modal,
    body,
    onEscape: opts.onClose,
    destroy: () => {
      window.removeEventListener("keydown", onKey, true);
      root.remove();
    },
  };

  
  
  
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") handle.onEscape();
  };
  window.addEventListener("keydown", onKey, true);

  scene.events.once("shutdown", handle.destroy);

  return handle;
}

export function domBtn(
  scene: Phaser.Scene,
  label: string,
  onClick: () => void,
  opts: { variant?: "grey"; big?: boolean } = {},
): HTMLButtonElement {
  const b = el("button", "pixl-btn", label);
  b.type = "button";
  if (opts.variant === "grey") b.classList.add("grey");
  if (opts.big) b.classList.add("big");
  b.addEventListener("click", () => {
    playUiSound(scene, "sfx-click");
    onClick();
  });
  return b;
}
