import Phaser from "phaser";
import { openDomModal, domBtn, el, type DomModal } from "../ui/dom";
import { gameSocket } from "../network/socket";
import { getShopItem } from "../shop/catalog";
import type { InventoryEntry } from "../types/network";

interface InventoryInit {
  from: string;
}

export class InventoryScene extends Phaser.Scene {
  private fromKey = "WorldScene";
  private modal?: DomModal;
  private items: InventoryEntry[] = [];
  private listEl?: HTMLDivElement;

  constructor() {
    super({ key: "InventoryScene" });
  }

  init(data: InventoryInit) {
    this.fromKey = data?.from ?? "WorldScene";
  }

  create() {
    this.scene.pause(this.fromKey);
    this.events.once("shutdown", () => {
      this.scene.resume(this.fromKey);
      gameSocket.off("inventory:list", this.onList);
      this.modal = undefined;
    });

    const world = this.scene.get("WorldScene") as
      | (Phaser.Scene & {
          isInHouse: () => boolean;
          beginPlacement: (id: string) => void;
        })
      | undefined;
    const inHouse = world?.isInHouse() ?? false;

    this.modal = openDomModal(this, {
      title: "Inventory",
      width: 560,
      onClose: () => this.scene.stop(),
    });

    const body = this.modal.body;

    const hint = el("div", "pixl-hint");
    hint.textContent = inHouse
      ? "Place furniture in the house"
      : "Enter the house to place furniture";
    body.append(hint);

    this.listEl = el("div", "pixl-list");
    this.listEl.textContent = "Loading…";
    body.append(this.listEl);

    const actions = el("div", "pixl-actions");
    actions.append(
      domBtn(this, "Close", () => this.scene.stop(), { variant: "grey", big: true }),
    );
    body.append(actions);

    this.input.keyboard?.on("keydown-ESC", () => this.scene.stop());
    this.input.keyboard?.on("keydown-B", () => this.scene.stop());

    gameSocket.on("inventory:list", this.onList);
    gameSocket.requestInventory();
  }

  private onList = ({ items }: { items: InventoryEntry[] }) => {
    this.items = items;
    this.render();
  };

  private render() {
    if (!this.listEl) return;

    if (this.items.length === 0) {
      this.listEl.innerHTML = "";
      const empty = el("div", "pixl-empty", "Your bag is empty — buy things at the shop");
      this.listEl.append(empty);
      return;
    }

    this.listEl.innerHTML = "";
    for (const entry of this.items) {
      const item = getShopItem(entry.itemId);
      if (!item) continue;

      const row = el("div", "pixl-row");
      row.append(el("div", "pixl-glyph", item.glyph));

      const main = el("div", "pixl-row-main");
      main.append(
        el("div", "pixl-row-name", `${item.name}  ×${entry.count}`),
      );
      if (item.blurb) {
        main.append(el("div", "pixl-row-meta", item.blurb));
      }
      row.append(main);

      if (item.placeable) {
        row.append(
          domBtn(this, "Place", () => {
            const world = this.scene.get("WorldScene") as
              | (Phaser.Scene & { beginPlacement: (id: string) => void })
              | undefined;
            world?.beginPlacement(entry.itemId);
            this.scene.stop();
          }),
        );
      }

      this.listEl.append(row);
    }
  }
}
