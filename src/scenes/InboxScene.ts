import Phaser from "phaser";
import { makeMenuButton } from "../utils/MenuButton";
import { FONT, FONT_TITLE, FONT_NARROW, COLORS } from "../ui/theme";
import { panel, closeButton, fitModal } from "../ui/UIKit";
import { gameSocket } from "../network/socket";
import type { Notification } from "../types/network";
import { UIScene } from "./UIScene";

interface InboxInit {
  from: string;
}

const VISIBLE = 5; // notification cards shown at once

// Overlay panel showing the persistent notification inbox. Pending village
// invites can be accepted (granting access to that village) or declined;
// accepted invites get a quick "VISIT" shortcut into the village.
export class InboxScene extends Phaser.Scene {
  private fromKey = "WorldScene";
  private items: Notification[] = [];
  private scroll = 0;
  private cards: Phaser.GameObjects.GameObject[] = [];
  private emptyText?: Phaser.GameObjects.Text;
  private listX = 0;
  private listY = 0;
  private listW = 0;

  constructor() {
    super({ key: "InboxScene" });
  }

  init(data: InboxInit) {
    this.fromKey = data?.from ?? "WorldScene";
  }

  create() {
    const W = this.scale.width;
    const H = this.scale.height;

    this.scene.pause(this.fromKey);
    this.events.once("shutdown", () => {
      this.scene.resume(this.fromKey);
      gameSocket.off("notify:list", this.onList);
      gameSocket.off("notify:new", this.onNew);
    });

    this.add.zone(0, 0, W, H).setOrigin(0).setInteractive();

    const panelW = 520;
    const panelH = 460;
    const px = (W - panelW) / 2;
    const py = (H - panelH) / 2;
    panel(this, W / 2, H / 2, panelW, panelH, "ui-panel-dark");
    closeButton(this, px + panelW - 26, py + 24, () => this.scene.stop());
    fitModal(this, panelW, panelH);

    this.add
      .text(W / 2, py + 28, "NOTIFICATIONS", { fontFamily: FONT_TITLE, fontSize: "18px", color: "#f0a500" })
      .setOrigin(0.5);

    this.listX = px + 28;
    this.listY = py + 70;
    this.listW = panelW - 56;

    this.emptyText = this.add
      .text(W / 2, this.listY + 80, "Loading…", { fontFamily: FONT_NARROW, fontSize: "14px", color: COLORS.textDim })
      .setOrigin(0.5);

    makeMenuButton(this, W / 2, py + panelH - 38, "CLOSE", {
      variant: "grey",
      onClick: () => this.scene.stop(),
    });

    this.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      const max = Math.max(0, this.items.length - VISIBLE);
      this.scroll = Phaser.Math.Clamp(this.scroll + (dy > 0 ? 1 : -1), 0, max);
      this.render();
    });
    this.input.keyboard?.on("keydown-ESC", () => this.scene.stop());

    gameSocket.on("notify:list", this.onList);
    gameSocket.on("notify:new", this.onNew);
    gameSocket.requestNotifications();
  }

  private onList = ({ items }: { items: Notification[]; unread: number }) => {
    this.items = items;
    // Listing marks everything read server-side — clear the HUD badge too.
    (this.scene.get("UIScene") as UIScene | undefined)?.setUnread(0);
    this.render();
  };

  // A notification can land while the inbox is open — prepend it live.
  private onNew = ({ item }: { item: Notification }) => {
    this.items.unshift(item);
    (this.scene.get("UIScene") as UIScene | undefined)?.setUnread(0);
    this.render();
  };

  private render() {
    for (const c of this.cards) c.destroy();
    this.cards.length = 0;

    this.emptyText?.setVisible(this.items.length === 0).setText(
      this.items.length === 0 ? "No notifications yet" : "",
    );

    const cardH = 72;
    const slice = this.items.slice(this.scroll, this.scroll + VISIBLE);
    slice.forEach((item, i) => {
      const y = this.listY + i * (cardH + 6);
      const cx = this.listX + this.listW / 2;

      const bg = this.add
        .rectangle(cx, y + cardH / 2, this.listW, cardH, 0xffffff, 0.05)
        .setStrokeStyle(1, 0xffffff, 0.12);
      this.cards.push(bg);

      const msg = this.add
        .text(this.listX + 14, y + 12, item.message ?? item.fromName, {
          fontFamily: FONT_NARROW,
          fontSize: "14px",
          color: "#ffffff",
          wordWrap: { width: this.listW - 150 },
        })
        .setResolution(3);
      this.cards.push(msg);

      this.addActions(item, this.listX + this.listW - 14, y + cardH / 2);
    });
  }

  // Right-aligned action area for a card, depending on the item's status.
  private addActions(item: Notification, rightX: number, cy: number) {
    if (item.status === "pending" && item.type === "village_invite") {
      const accept = makeMenuButton(this, rightX - 50, cy - 18, "ACCEPT", {
        width: 100, height: 30,
        onClick: () => this.respond(item, true),
      });
      const decline = makeMenuButton(this, rightX - 50, cy + 18, "DECLINE", {
        width: 100, height: 30, variant: "grey",
        onClick: () => this.respond(item, false),
      });
      this.cards.push(accept.container, decline.container);
      return;
    }
    if (item.status === "accepted" && item.type === "village_invite") {
      // Accepted: offer a quick jump into that village.
      const visit = makeMenuButton(this, rightX - 50, cy, "VISIT", {
        width: 100, height: 32,
        onClick: () => {
          gameSocket.enterWorld({ kind: "village", ownerPlayerId: item.fromId });
          this.scene.stop();
        },
      });
      this.cards.push(visit.container);
      return;
    }
    const label = this.add
      .text(rightX, cy, item.status.toUpperCase(), {
        fontFamily: FONT,
        fontSize: "10px",
        color: item.status === "declined" ? "#ff7777" : COLORS.textDim,
      })
      .setOrigin(1, 0.5);
    this.cards.push(label);
  }

  private respond(item: Notification, accept: boolean) {
    gameSocket.respondNotification(item.id, accept);
    item.status = accept ? "accepted" : "declined";
    this.render();
  }
}
