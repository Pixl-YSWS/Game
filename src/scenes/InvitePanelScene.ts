import Phaser from "phaser";
import { openDomModal, domBtn, el, type DomModal } from "../ui/dom";
import { gameSocket } from "../network/socket";
import type { PlayerDirEntry } from "../types/network";

export class InvitePanelScene extends Phaser.Scene {
  private all: PlayerDirEntry[] = [];
  private invited = new Set<string>();
  private query = "";
  private modal?: DomModal;
  private listEl?: HTMLDivElement;
  private toastEl?: HTMLDivElement;
  private toastTimer?: number;

  constructor() {
    super({ key: "InvitePanelScene" });
  }

  create() {
    // No scene.pause — the world keeps running behind this overlay (multiplayer).
    this.events.once("shutdown", () => {
      gameSocket.off("players:list", this.onList);
      gameSocket.off("invite:sent", this.onSent);
      gameSocket.off("invite:error", this.onError);
      window.clearTimeout(this.toastTimer);
      this.modal?.destroy();
    });

    const modal = openDomModal(this, {
      title: "Invite to Village",
      width: 540,
      onClose: () => this.scene.stop(),
    });
    this.modal = modal;

    const search = el("input", "pixl-input");
    search.placeholder = "Search players…";
    search.maxLength = 32;
    search.style.width = "100%";
    search.addEventListener("input", () => {
      this.query = search.value.trim().toLowerCase();
      this.render();
    });
    modal.body.append(search);

    this.listEl = el("div", "pixl-list");
    modal.body.append(this.listEl);

    this.toastEl = el("div", "pixl-row-meta");
    this.toastEl.style.cssText =
      "text-align:center; min-height:16px; margin-top:6px;";
    modal.body.append(this.toastEl);

    setTimeout(() => search.focus(), 50);

    gameSocket.on("players:list", this.onList);
    gameSocket.on("invite:sent", this.onSent);
    gameSocket.on("invite:error", this.onError);
    gameSocket.requestPlayers();
    this.render();
  }

  private onList = ({ players }: { players: PlayerDirEntry[] }) => {
    this.all = players;
    this.render();
  };

  private onSent = ({ toName }: { toName: string }) => {
    this.flash(`Invite sent to ${toName}`, "#7dda1c");
  };

  private onError = ({ reason }: { reason: string }) => {
    const human: Record<string, string> = {
      already_invited: "You already invited them",
      invalid_target: "Can't invite that player",
    };
    this.flash(human[reason] ?? `Couldn't invite: ${reason}`, "#ff7777");
  };

  private render() {
    const list = this.listEl;
    if (!list) return;
    const filtered = this.query
      ? this.all.filter((p) => p.name.toLowerCase().includes(this.query))
      : this.all;
    list.replaceChildren();

    if (filtered.length === 0) {
      list.append(
        el(
          "div",
          "pixl-row-meta",
          this.all.length === 0
            ? "Loading players…"
            : "No players match your search",
        ),
      );
      return;
    }

    const sorted = [...filtered].sort(
      (a, b) =>
        Number(b.online) - Number(a.online) || a.name.localeCompare(b.name),
    );
    for (const p of sorted) list.append(this.row(p));
  }

  private row(p: PlayerDirEntry): HTMLElement {
    const r = el("div", "pixl-row");
    const dot = el("span");
    dot.style.cssText = `width:8px; height:8px; border-radius:50%; flex-shrink:0; background:${
      p.online ? "#4ade80" : "#555566"
    };`;
    const main = el("div", "pixl-row-main");
    main.append(el("div", "pixl-row-name", p.name));

    const done = this.invited.has(p.accountId);
    const btn = domBtn(
      this,
      done ? "Sent" : "Invite",
      () => {
        if (this.invited.has(p.accountId)) return;
        this.invited.add(p.accountId);
        gameSocket.sendInvite(p.accountId);
        this.render();
      },
      done ? { variant: "grey" } : {},
    );
    if (done) btn.disabled = true;

    r.append(dot, main, btn);
    return r;
  }

  private flash(msg: string, color: string) {
    if (!this.toastEl) return;
    this.toastEl.textContent = msg;
    this.toastEl.style.color = color;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      if (this.toastEl) this.toastEl.textContent = "";
    }, 1400);
  }
}
