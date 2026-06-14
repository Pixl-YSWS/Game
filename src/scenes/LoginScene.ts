import Phaser from "phaser";
import { domBtn, el, injectStyles } from "../ui/dom";
import { CURSORS } from "../ui/theme";
import { SERVER_URL } from "../network/socket";
import {
  setSessionToken,
  setAccountId,
  setAccountName,
} from "../network/playerIdentity";

interface LoginInit {
  message?: string;
}

const STYLE_ID = "pixl-login-menu";

function injectLoginStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
#pixl-login-root {
  position: fixed; inset: 0; z-index: 50;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  font-family: "Monocraft", "Pixelify Sans", monospace;
  font-size: 15px;
  color: #f4e3c2;
  background: #0d0d1a;
  outline: none;
}
#pixl-login-root .pixl-title { margin-bottom: 24px; }
#pixl-login-root .pixl-actions {
  flex-direction: column; align-items: stretch; gap: 8px; margin-top: 8px;
  width: min(400px, calc(100vw - 48px));
}
#pixl-login-root .pixl-divider {
  text-align: center; font-size: 12px; color: #667; margin: 6px 0 2px;
}
#pixl-login-root .pixl-login-input {
  width: 100%; box-sizing: border-box;
  background: #1c1209;
  border: 3px solid #5a4632;
  color: #f4e3c2; padding: 10px 14px;
  font-family: inherit; font-size: 15px; text-align: center;
  outline: none;
  box-shadow: inset 3px 3px 0 rgba(0, 0, 0, 0.45);
}
#pixl-login-root .pixl-login-input:focus { border-color: #ffd166; }
#pixl-login-root .pixl-login-input::placeholder { color: #7d6a50; }
#pixl-login-root .pixl-status {
  min-height: 18px; text-align: center; font-size: 12px;
  margin-top: 10px; color: #e0604f; max-width: 360px; line-height: 1.5;
}
#pixl-login-root .pixl-btn { width: 100%; }
#pixl-login-root .pixl-btn:focus { outline: 2px solid #ffd166; outline-offset: 2px; }
#pixl-login-root button { cursor: ${CURSORS.pointer}; }
#pixl-login-root .pixl-footer {
  position: absolute; bottom: 16px;
  font-size: 11px; color: #555566; text-align: center;
}
`;
  document.head.appendChild(style);
}

export class LoginScene extends Phaser.Scene {
  private root?: HTMLDivElement;
  private status?: HTMLDivElement;
  private guestInput?: HTMLInputElement;

  constructor() {
    super({ key: "LoginScene" });
  }

  create(data: LoginInit) {
    injectStyles();
    injectLoginStyles();

    this.root = el("div", "pixl-overlay");
    this.root.id = "pixl-login-root";

    const title = el("div", "pixl-title", "PixlGame");
    this.root.append(title);

    const subtitle = el("div", undefined, "a tiny multiplayer world");
    Object.assign(subtitle.style, {
      fontFamily: '"Monocraft", "Pixelify Sans", monospace',
      fontSize: "13px",
      color: "#888899",
      marginTop: "-4px",
      marginBottom: "12px",
    });
    this.root.append(subtitle);

    const actions = el("div", "pixl-actions");

    const btns: HTMLButtonElement[] = [];
    const loginBtn = domBtn(this, "Login with Hack Club", () => this.login(), {
      big: true,
    });
    btns.push(loginBtn);
    actions.append(loginBtn);

    actions.append(el("div", "pixl-divider", "— or play as a guest —"));

    const input = el("input", "pixl-login-input") as HTMLInputElement;
    input.type = "text";
    input.maxLength = 24;
    input.placeholder = "Guest name";
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") this.joinAsGuest();
    });
    this.guestInput = input;
    actions.append(input);

    const guestBtn = domBtn(this, "Join as Guest", () => this.joinAsGuest(), {
      big: true,
      variant: "grey",
    });
    btns.push(guestBtn);
    actions.append(guestBtn);

    this.root.append(actions);

    this.status = el("div", "pixl-status", data?.message ?? "");
    this.root.append(this.status);

    const footer = el(
      "div",
      "pixl-footer",
      "Hack Club login keeps your progress · guests are temporary",
    );
    this.root.append(footer);

    document.body.append(this.root);
    loginBtn.focus();

    // Arrow / WASD navigation between buttons, matching the main menu — but
    // never while typing a guest name.
    const onKey = (e: KeyboardEvent) => {
      if (!this.root || !document.body.contains(this.root)) return;
      if (document.activeElement === this.guestInput) return;
      e.stopPropagation();
      const idx = btns.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === "ArrowDown" || e.key.toLowerCase() === "s") {
        e.preventDefault();
        btns[(idx + 1) % btns.length].focus();
      } else if (e.key === "ArrowUp" || e.key.toLowerCase() === "w") {
        e.preventDefault();
        btns[(idx - 1 + btns.length) % btns.length].focus();
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (idx >= 0) btns[idx].click();
      }
    };
    window.addEventListener("keydown", onKey, true);

    this.events.once("shutdown", () => {
      window.removeEventListener("keydown", onKey, true);
      this.root?.remove();
      this.root = undefined;
    });
  }

  private setStatus(text: string, color = "#e0604f") {
    if (!this.status) return;
    this.status.textContent = text;
    this.status.style.color = color;
  }

  private login() {
    window.location.href = `${SERVER_URL}/auth/login`;
  }

  private async joinAsGuest() {
    const name = (this.guestInput?.value ?? "").trim();
    if (!name) {
      this.setStatus("Enter a name first.");
      this.guestInput?.focus();
      return;
    }
    this.setStatus("Joining…", "#c9b18c");
    try {
      const res = await fetch(
        `${SERVER_URL}/auth/guest?name=${encodeURIComponent(name)}`,
      );
      const result = (await res.json()) as {
        ok: boolean;
        token?: string;
        accountId?: string;
        name?: string;
      };
      if (!res.ok || !result.ok || !result.token) {
        this.setStatus("Guest login is disabled.");
        return;
      }
      setSessionToken(result.token);
      setAccountId(result.accountId ?? "");
      setAccountName(result.name ?? name);
      this.scene.start("MainMenuScene");
    } catch {
      this.setStatus("Can't reach the server. Is it running?");
    }
  }
}
