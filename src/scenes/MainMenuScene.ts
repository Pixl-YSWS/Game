import Phaser from "phaser";
import { domBtn, el, injectStyles } from "../ui/dom";
import { CURSORS } from "../ui/theme";
import {
  getAccountId,
  getAccountName,
  getSessionToken,
  clearSession,
} from "../network/playerIdentity";
import { gameSocket, SERVER_URL } from "../network/socket";
import type { WorldRef } from "../types/network";

interface JoinableVillage {
  ownerId: string;
  name: string;
}

const STYLE_ID = "pixl-main-menu";

function injectMainStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
#pixl-main-root {
  position: fixed; inset: 0; z-index: 50;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  font-family: "Monocraft", "Pixelify Sans", monospace;
  font-size: 15px;
  color: #f4e3c2;
  background: #0d0d1a;
  outline: none;
}
#pixl-main-root .pixl-title {
  margin-bottom: 24px;
}
#pixl-main-root .pixl-actions {
  flex-direction: column; align-items: stretch; gap: 8px; margin-top: 8px;
  width: min(400px, calc(100vw - 48px));
}
#pixl-main-root .pixl-sub {
  font-family: "Pixelify Sans", sans-serif;
  text-align: center; font-size: 18px; letter-spacing: 1px;
  color: #ffd166; margin-bottom: 8px;
}
#pixl-main-root .pixl-footer {
  position: absolute; bottom: 16px;
  font-size: 12px; color: #888899; text-align: center;
}
#pixl-main-root .pixl-btn { width: 100%; }
#pixl-main-root .pixl-btn:focus { outline: 2px solid #ffd166; outline-offset: 2px; }
#pixl-main-root button { cursor: ${CURSORS.pointer}; }
`;
  document.head.appendChild(style);
}

export class MainMenuScene extends Phaser.Scene {
  private root?: HTMLDivElement;

  constructor() {
    super({ key: "MainMenuScene" });
  }

  create() {
    injectStyles();
    injectMainStyles();

    this.root = el("div", "pixl-overlay");
    this.root.id = "pixl-main-root";
    this.root.style.background = "#0d0d1a";
    this.root.style.zIndex = "50";

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

    const name = getAccountName();
    if (name) {
      const signedIn = el("div", undefined, `Signed in as ${name}`);
      Object.assign(signedIn.style, {
        fontSize: "13px",
        color: "#7bdc8b",
        marginBottom: "12px",
      });
      this.root.append(signedIn);
    }

    const actions = el("div", "pixl-actions");

    this.fetchVillages().then((villages) => {
      if (!this.scene.isActive("MainMenuScene")) return;

      const btns: HTMLButtonElement[] = [];

      const addBtn = (label: string, onClick: () => void, variant?: "grey") => {
        const b = domBtn(this, label, onClick, { big: true, variant });
        b.style.width = "100%";
        btns.push(b);
        actions.append(b);
      };

      addBtn("Join Village", () =>
        this.startWorld({ kind: "village", ownerPlayerId: getAccountId() }),
      );
      addBtn("Join Open World", () =>
        this.startWorld({ kind: "openworld" }),
      );

      for (const v of villages) {
        addBtn(`Visit ${v.name}`, () =>
          this.startWorld({ kind: "village", ownerPlayerId: v.ownerId }),
        );
      }

      addBtn("Character", () =>
        this.scene.launch("CharacterScene", { from: "MainMenuScene" }),
      );
      addBtn("Settings", () =>
        this.scene.launch("SettingsScene", { from: "MainMenuScene" }),
      );
      addBtn("Logout", () => this.logout(), "grey");

      btns[0]?.focus();

      const onKey = (e: KeyboardEvent) => {
        if (!document.body.contains(btns[0])) return;
        e.stopPropagation();
        const idx = btns.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === "ArrowDown" || e.key.toLowerCase() === "s") {
          e.preventDefault();
          btns[(idx + 1) % btns.length].focus();
        } else if (e.key === "ArrowUp" || e.key.toLowerCase() === "w") {
          e.preventDefault();
          btns[(idx - 1 + btns.length) % btns.length].focus();
        } else if (e.key === "Enter" || e.key === " ") {
          if (idx >= 0) btns[idx].click();
        }
      };
      window.addEventListener("keydown", onKey, true);
      this.events.once("shutdown", () => window.removeEventListener("keydown", onKey, true));
    });

    this.root.append(actions);

    const footer = el("div", "pixl-footer", "ESC pauses the game once you're in");
    this.root.append(footer);

    document.body.append(this.root);

    this.events.once("shutdown", () => {
      this.root?.remove();
      this.root = undefined;
    });
  }

  private async fetchVillages(): Promise<JoinableVillage[]> {
    const token = getSessionToken();
    if (!token) return [];
    try {
      const r = await fetch(
        `${SERVER_URL}/api/villages?token=${encodeURIComponent(token)}`,
      );
      if (!r.ok) return [];
      const d = (await r.json()) as {
        ok: boolean;
        villages?: JoinableVillage[];
      };
      return d.ok ? (d.villages ?? []) : [];
    } catch {
      return [];
    }
  }

  private startWorld(world: WorldRef | undefined) {
    this.scene.start("WorldScene", { initialWorld: world });
  }

  private logout() {
    clearSession();
    gameSocket.disconnect();
    this.scene.start("LoginScene", { message: "You've been logged out." });
  }
}
