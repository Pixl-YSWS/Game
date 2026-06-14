import Phaser from "phaser";
import { domBtn, el, injectStyles, openDomModal } from "../ui/dom";
import { CURSORS } from "../ui/theme";
import {
  getAccountId,
  getAccountName,
  getSessionToken,
  clearSession,
} from "../network/playerIdentity";
import { gameSocket, SERVER_URL } from "../network/socket";
import type { WorldRef, LobbyAction, LobbyInfo } from "../types/network";

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
        return b;
      };

      addBtn("Join Village", () =>
        this.startWorld({ kind: "village", ownerPlayerId: getAccountId() }),
      );
      addBtn("Lobbies", () => this.openLobbyPanel());

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
      // Logout is keyboard-reachable and destructive, so it takes two presses:
      // a stray Enter/click arms it ("Confirm logout?") instead of logging out.
      let logoutArmed = false;
      let logoutRevert: number | undefined;
      const logoutBtn = addBtn(
        "Logout",
        () => {
          if (!logoutArmed) {
            logoutArmed = true;
            logoutBtn.textContent = "Confirm logout?";
            window.clearTimeout(logoutRevert);
            logoutRevert = window.setTimeout(() => {
              logoutArmed = false;
              logoutBtn.textContent = "Logout";
            }, 3000);
            return;
          }
          window.clearTimeout(logoutRevert);
          this.logout();
        },
        "grey",
      );

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
          // preventDefault so the focused button isn't *also* activated
          // natively (a double-fire); we trigger the click ourselves.
          e.preventDefault();
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

    // The menu root is an opaque full-screen overlay (z-50), so it covers any
    // modal (z-40) launched on top. Hide it while a sub-scene (Character,
    // Settings, …) is paused over us, and restore it when we resume.
    this.events.on("pause", () => this.showRoot(false));
    this.events.on("resume", () => this.showRoot(true));
    this.events.on("sleep", () => this.showRoot(false));
    this.events.on("wake", () => this.showRoot(true));

    this.events.once("shutdown", () => {
      this.root?.remove();
      this.root = undefined;
    });
  }

  private showRoot(show: boolean) {
    if (this.root) this.root.style.display = show ? "flex" : "none";
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

  private startLobby(action: LobbyAction) {
    this.scene.start("WorldScene", { lobbyAction: action });
  }

  private async fetchLobbies(): Promise<LobbyInfo[]> {
    const token = getSessionToken();
    if (!token) return [];
    try {
      const r = await fetch(
        `${SERVER_URL}/api/lobbies?token=${encodeURIComponent(token)}`,
      );
      if (!r.ok) return [];
      const d = (await r.json()) as { ok: boolean; lobbies?: LobbyInfo[] };
      return d.ok ? (d.lobbies ?? []) : [];
    } catch {
      return [];
    }
  }

  // Lobby browser: list every joinable lobby, quick-join, or create your own.
  // Private lobbies need their 4-digit password to join.
  private openLobbyPanel() {
    // This modal is opened in-scene (the menu isn't paused), so hide the opaque
    // menu root ourselves while it's up, then restore it on close.
    this.showRoot(false);
    const modal = openDomModal(this, {
      title: "Lobbies",
      width: 420,
      onClose: () => {
        this.showRoot(true);
        modal.destroy();
      },
    });
    const go = (a: LobbyAction) => {
      modal.destroy();
      this.startLobby(a);
    };
    this.renderLobbyList(modal, go);
  }

  private renderLobbyList(
    modal: { body: HTMLDivElement },
    go: (a: LobbyAction) => void,
  ) {
    modal.body.replaceChildren();

    const top = el("div", "pixl-actions");
    const quick = domBtn(this, "Quick Join", () => go({ type: "quick" }));
    const create = domBtn(
      this,
      "Create Lobby",
      () => this.renderLobbyCreate(modal, go),
      { variant: "grey" },
    );
    top.append(quick, create);
    modal.body.append(top);

    const list = el("div", "pixl-list");
    const loading = el("div", "pixl-row-meta", "Loading lobbies…");
    list.append(loading);
    modal.body.append(list);

    this.fetchLobbies().then((lobbies) => {
      if (!list.isConnected) return;
      list.replaceChildren();
      if (lobbies.length === 0) {
        list.append(
          el("div", "pixl-row-meta", "No lobbies yet — create one!"),
        );
        return;
      }
      for (const lobby of lobbies) list.append(this.lobbyRow(lobby, go));
    });
  }

  private lobbyRow(lobby: LobbyInfo, go: (a: LobbyAction) => void): HTMLElement {
    const row = el("div", "pixl-row");
    row.append(el("div", "pixl-glyph", lobby.isPublic ? "🌐" : "🔒"));
    const main = el("div", "pixl-row-main");
    main.append(
      el("div", "pixl-row-name", lobby.name),
      el(
        "div",
        "pixl-row-meta",
        `${lobby.count}/${lobby.capacity}${lobby.isPublic ? "" : " · private"}`,
      ),
    );
    row.append(main);

    const full = lobby.count >= lobby.capacity;
    const joinBtn = domBtn(this, full ? "Full" : "Join", () => {
      if (full) return;
      if (lobby.isPublic) {
        go({ type: "join", id: lobby.id });
      } else {
        this.promptLobbyPassword(main, lobby, go);
      }
    });
    if (full) joinBtn.disabled = true;
    row.append(joinBtn);
    return row;
  }

  // Inline 4-digit password entry for joining a private lobby.
  private promptLobbyPassword(
    container: HTMLElement,
    lobby: LobbyInfo,
    go: (a: LobbyAction) => void,
  ) {
    const existing = container.parentElement?.querySelector(".pixl-pass-row");
    if (existing) {
      (existing.querySelector("input") as HTMLInputElement)?.focus();
      return;
    }
    const row = el("div", "pixl-pass-row");
    row.style.cssText = "display:flex; gap:8px; margin-top:6px;";
    const input = el("input", "pixl-input");
    input.placeholder = "4-digit code";
    input.maxLength = 4;
    input.inputMode = "numeric";
    input.style.flex = "1";
    const enter = domBtn(this, "Go", () => {
      const password = input.value.trim();
      if (password.length === 4) go({ type: "join", id: lobby.id, password });
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") enter.click();
    });
    row.append(input, enter);
    container.append(row);
    input.focus();
  }

  private renderLobbyCreate(
    modal: { body: HTMLDivElement },
    go: (a: LobbyAction) => void,
  ) {
    modal.body.replaceChildren();

    const nameInput = el("input", "pixl-input");
    nameInput.placeholder = "Lobby name (optional)";
    nameInput.maxLength = 30;
    nameInput.style.width = "100%";
    modal.body.append(nameInput);

    let isPublic = true;
    const toggleRow = el("div", "pixl-actions");
    toggleRow.style.marginTop = "10px";
    const pubBtn = domBtn(this, "Public", () => setPublic(true));
    const privBtn = domBtn(this, "Private", () => setPublic(false), {
      variant: "grey",
    });
    const setPublic = (v: boolean) => {
      isPublic = v;
      pubBtn.classList.toggle("grey", !v);
      privBtn.classList.toggle("grey", v);
    };
    toggleRow.append(pubBtn, privBtn);
    modal.body.append(toggleRow);

    const hint = el(
      "div",
      "pixl-row-meta",
      "Private lobbies get a 4-digit password to share.",
    );
    hint.style.marginTop = "8px";
    modal.body.append(hint);

    const actions = el("div", "pixl-actions");
    actions.style.marginTop = "12px";
    const back = domBtn(
      this,
      "Back",
      () => this.renderLobbyList(modal, go),
      { variant: "grey" },
    );
    const createBtn = domBtn(this, "Create", () =>
      go({ type: "create", isPublic, name: nameInput.value.trim() || undefined }),
    );
    actions.append(back, createBtn);
    modal.body.append(actions);
    nameInput.focus();
  }

  private logout() {
    clearSession();
    gameSocket.disconnect();
    this.scene.start("LoginScene", { message: "You've been logged out." });
  }
}
