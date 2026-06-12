import Phaser from "phaser";
import { openDomModal, domBtn, el, type DomModal } from "../ui/dom";
import { gameSocket } from "../network/socket";
import type { Notification } from "../types/network";
import { UIScene } from "./UIScene";

interface InboxInit {
  from: string;
}

export class InboxScene extends Phaser.Scene {
  private fromKey = "WorldScene";
  private modal?: DomModal;
  private items: Notification[] = [];
  private listEl?: HTMLDivElement;

  constructor() {
    super({ key: "InboxScene" });
  }

  init(data: InboxInit) {
    this.fromKey = data?.from ?? "WorldScene";
  }

  create() {
    this.scene.pause(this.fromKey);
    this.events.once("shutdown", () => {
      this.scene.resume(this.fromKey);
      gameSocket.off("notify:list", this.onList);
      gameSocket.off("notify:new", this.onNew);
      this.modal = undefined;
    });

    this.modal = openDomModal(this, {
      title: "Notifications",
      width: 560,
      onClose: () => this.scene.stop(),
    });

    const body = this.modal.body;

    this.listEl = el("div", "pixl-list");
    this.listEl.textContent = "Loading…";
    body.append(this.listEl);

    const actions = el("div", "pixl-actions");
    actions.append(
      domBtn(this, "Close", () => this.scene.stop(), { variant: "grey", big: true }),
    );
    body.append(actions);

    this.input.keyboard?.on("keydown-ESC", () => this.scene.stop());

    gameSocket.on("notify:list", this.onList);
    gameSocket.on("notify:new", this.onNew);
    gameSocket.requestNotifications();
  }

  private onList = ({ items }: { items: Notification[]; unread: number }) => {
    this.items = items;
    (this.scene.get("UIScene") as UIScene | undefined)?.setUnread(0);
    this.render();
  };

  private onNew = ({ item }: { item: Notification }) => {
    this.items.unshift(item);
    (this.scene.get("UIScene") as UIScene | undefined)?.setUnread(0);
    this.render();
  };

  private render() {
    if (!this.listEl) return;

    if (this.items.length === 0) {
      this.listEl.innerHTML = "";
      const empty = el("div", "pixl-empty", "No notifications yet");
      this.listEl.append(empty);
      return;
    }

    this.listEl.innerHTML = "";
    for (const item of this.items) {
      const row = el("div", "pixl-row");
      row.style.flexDirection = "column";
      row.style.alignItems = "stretch";
      row.style.gap = "6px";

      const msg = el("div", undefined, item.message ?? item.fromName);
      Object.assign(msg.style, {
        fontSize: "14px",
        color: "#f4e3c2",
      });
      row.append(msg);

      if (item.status === "pending" && item.type === "village_invite") {
        const btns = el("div", "pixl-actions");
        btns.style.justifyContent = "flex-end";
        btns.style.marginTop = "0";
        btns.append(
          domBtn(this, "Accept", () => this.respond(item, true)),
          domBtn(this, "Decline", () => this.respond(item, false), { variant: "grey" }),
        );
        row.append(btns);
      } else if (item.status === "accepted" && item.type === "village_invite") {
        const btns = el("div", "pixl-actions");
        btns.style.justifyContent = "flex-end";
        btns.style.marginTop = "0";
        btns.append(
          domBtn(this, "Visit", () => {
            gameSocket.enterWorld({
              kind: "village",
              ownerPlayerId: item.fromId,
            });
            this.scene.stop();
          }),
        );
        row.append(btns);
      } else {
        const status = el("div", undefined, item.status.toUpperCase());
        Object.assign(status.style, {
          fontSize: "11px",
          color: item.status === "declined" ? "#ff7777" : "#c9b18c",
          textAlign: "right",
        });
        row.append(status);
      }

      this.listEl.append(row);
    }
  }

  private respond(item: Notification, accept: boolean) {
    gameSocket.respondNotification(item.id, accept);
    item.status = accept ? "accepted" : "declined";
    this.render();
  }
}
