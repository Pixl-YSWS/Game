import Phaser from "phaser";
import { openDomModal, domBtn, el, type DomModal } from "../ui/dom";
import { gameSocket } from "../network/socket";
import type { ModRole, AdminEntry, MuteEntry, AdminPlayerEntry } from "../types/network";

interface AdminInit {
  from?: string;
  role?: ModRole;
}

interface Person {
  accountId: string;
  name: string;
  role: ModRole;
  chatMuted: boolean;
  voiceMuted: boolean;
  online: boolean;
}

export class AdminScene extends Phaser.Scene {
  private fromKey = "WorldScene";
  private myRole: ModRole = null;
  private modal?: DomModal;
  private people: Person[] = [];
  private listEl?: HTMLDivElement;
  private toastEl?: HTMLDivElement;

  constructor() {
    super({ key: "AdminScene" });
  }

  init(data: AdminInit) {
    this.fromKey = data?.from ?? "WorldScene";
    this.myRole = data?.role ?? null;
  }

  create() {
    // No scene.pause — the world keeps running behind this overlay (multiplayer).
    this.events.once("shutdown", () => {
      this.scene.resume(this.fromKey);
      gameSocket.off("admin:data", this.onData);
      this.modal = undefined;
    });

    this.modal = openDomModal(this, {
      title: "Admin Panel",
      width: 600,
      onClose: () => this.scene.stop(),
    });

    const body = this.modal.body;

    const roleLabel = el("div", "pixl-sub", this.myRole === "admin" ? "Admin" : "Moderator");
    body.append(roleLabel);

    this.listEl = el("div", "pixl-list");
    this.listEl.textContent = "Loading…";
    body.append(this.listEl);

    this.toastEl = el("div", "pixl-toast");

    const actions = el("div", "pixl-actions");
    actions.append(
      domBtn(this, "Close", () => this.scene.stop(), { variant: "grey", big: true }),
    );
    body.append(this.toastEl, actions);

    this.input.keyboard?.on("keydown-ESC", () => this.scene.stop());

    gameSocket.on("admin:data", this.onData);
    gameSocket.requestAdminData();
  }

  private onData = (data: { admins: AdminEntry[]; mutes: MuteEntry[]; online: AdminPlayerEntry[] }) => {
    const roleMap = new Map<string, ModRole>(data.admins.map((a) => [a.accountId, a.role]));
    const seen = new Set<string>();
    const people: Person[] = [];
    for (const p of data.online) {
      people.push({ accountId: p.accountId, name: p.name, role: p.role, chatMuted: p.chatMuted, voiceMuted: p.voiceMuted, online: true });
      seen.add(p.accountId);
    }
    for (const m of data.mutes) {
      if (seen.has(m.accountId)) continue;
      people.push({ accountId: m.accountId, name: m.name, role: roleMap.get(m.accountId) ?? null, chatMuted: m.chat, voiceMuted: m.voice, online: false });
    }
    people.sort((a, b) => (rank(b.role) - rank(a.role)) || a.name.localeCompare(b.name));
    this.people = people;
    this.render();
  };

  private render() {
    if (!this.listEl) return;

    if (this.people.length === 0) {
      this.listEl.innerHTML = "";
      const empty = el("div", "pixl-empty", "No players online");
      this.listEl.append(empty);
      return;
    }

    this.listEl.innerHTML = "";
    for (const p of this.people) {
      const row = el("div", "pixl-row");
      row.style.flexDirection = "column";
      row.style.alignItems = "stretch";
      row.style.gap = "4px";

      const top = el("div");
      top.style.display = "flex";
      top.style.alignItems = "center";
      top.style.gap = "8px";

      const tag = p.role === "admin" ? "  [ADMIN]" : p.role === "subadmin" ? "  [MOD]" : "";
      const nameColor = p.role ? "#ffd166" : p.online ? "#f4e3c2" : "#c9b18c";
      const nameEl = el("div", undefined, p.name + tag);
      Object.assign(nameEl.style, { fontSize: "15px", color: nameColor, fontWeight: "700" });
      top.append(nameEl);

      const status = p.chatMuted && p.voiceMuted
        ? "chat + mic muted"
        : p.chatMuted ? "chat muted"
        : p.voiceMuted ? "mic muted"
        : p.online ? "online" : "offline";
      const muted = p.chatMuted || p.voiceMuted;
      const statusEl = el("div", undefined, status);
      Object.assign(statusEl.style, { fontSize: "12px", color: muted ? "#ff6b6b" : "#c9b18c", flex: "1" });
      top.append(statusEl);

      row.append(top);

      const btns = el("div", "pixl-actions");
      btns.style.justifyContent = "flex-end";
      btns.style.marginTop = "0";

      const canMute = p.role === null;
      if (canMute) {
        btns.append(
          domBtn(this, p.chatMuted ? "Unmute Chat" : "Mute Chat", () => {
            p.chatMuted ? gameSocket.adminUnmute(p.accountId, "chat") : gameSocket.adminMute(p.accountId, "chat");
            this.flash("Done");
          }),
          domBtn(this, p.voiceMuted ? "Unmute Mic" : "Mute Mic", () => {
            p.voiceMuted ? gameSocket.adminUnmute(p.accountId, "voice") : gameSocket.adminMute(p.accountId, "voice");
            this.flash("Done");
          }),
        );
      }
      if (this.myRole === "admin" && p.role !== "admin") {
        if (p.role === "subadmin") {
          btns.append(
            domBtn(this, "Demote", () => {
              gameSocket.adminSetRole(p.accountId, "none");
              this.flash("Done");
            }, { variant: "grey" }),
          );
        } else {
          btns.append(
            domBtn(this, "Make Mod", () => {
              gameSocket.adminSetRole(p.accountId, "subadmin");
              this.flash("Done");
            }),
          );
        }
      }

      row.append(btns);
      this.listEl.append(row);
    }
  }

  private flash(msg: string) {
    if (!this.toastEl) return;
    this.toastEl.textContent = msg;
    clearTimeout((this as any)._flashTimer);
    (this as any)._flashTimer = setTimeout(() => {
      if (this.toastEl) this.toastEl.textContent = "";
    }, 1200);
  }
}

function rank(role: ModRole): number {
  return role === "admin" ? 2 : role === "subadmin" ? 1 : 0;
}
