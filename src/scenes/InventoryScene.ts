import Phaser from "phaser";
import { makeMenuButton } from "../utils/MenuButton";
import { FONT_TITLE, FONT_NARROW, FONT_EMOJI, COLORS } from "../ui/theme";
import { panel, closeButton, fitModal } from "../ui/UIKit";
import { gameSocket } from "../network/socket";
import { getShopItem } from "../shop/catalog";
import type { InventoryEntry } from "../types/network";

interface InventoryInit {
  from: string;
}

// Overlay listing the items the player owns. While in the shared house,
// placeable items get a PLACE button that hands off to WorldScene's
// placement mode.
export class InventoryScene extends Phaser.Scene {
  private fromKey = "WorldScene";
  private items: InventoryEntry[] = [];
  private cards: Phaser.GameObjects.GameObject[] = [];
  private emptyText?: Phaser.GameObjects.Text;
  private hintText?: Phaser.GameObjects.Text;
  private listX = 0;
  private listY = 0;
  private listW = 0;
  private inHouse = false;

  constructor() {
    super({ key: "InventoryScene" });
  }

  init(data: InventoryInit) {
    this.fromKey = data?.from ?? "WorldScene";
  }

  create() {
    const W = this.scale.width;
    const H = this.scale.height;

    this.scene.pause(this.fromKey);
    this.events.once("shutdown", () => {
      this.scene.resume(this.fromKey);
      gameSocket.off("inventory:list", this.onList);
    });

    const world = this.scene.get("WorldScene") as
      | (Phaser.Scene & { isInHouse: () => boolean; beginPlacement: (id: string) => void })
      | undefined;
    this.inHouse = world?.isInHouse() ?? false;

    this.add.zone(0, 0, W, H).setOrigin(0).setInteractive();

    const panelW = 520;
    const panelH = 460;
    const px = (W - panelW) / 2;
    const py = (H - panelH) / 2;
    panel(this, W / 2, H / 2, panelW, panelH, "ui-panel-dark");
    closeButton(this, px + panelW - 26, py + 24, () => this.scene.stop());
    fitModal(this, panelW, panelH);

    this.add
      .text(W / 2, py + 28, "INVENTORY", { fontFamily: FONT_TITLE, fontSize: "18px", color: "#f0a500" })
      .setOrigin(0.5);

    this.hintText = this.add
      .text(W / 2, py + 52, this.inHouse ? "Place furniture in the house" : "Enter the house to place furniture", {
        fontFamily: FONT_NARROW,
        fontSize: "12px",
        color: COLORS.textDim,
      })
      .setOrigin(0.5);

    this.listX = px + 28;
    this.listY = py + 84;
    this.listW = panelW - 56;

    this.emptyText = this.add
      .text(W / 2, this.listY + 70, "Loading…", { fontFamily: FONT_NARROW, fontSize: "14px", color: COLORS.textDim })
      .setOrigin(0.5);

    makeMenuButton(this, W / 2, py + panelH - 38, "CLOSE", {
      variant: "grey",
      onClick: () => this.scene.stop(),
    });

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
    for (const c of this.cards) c.destroy();
    this.cards.length = 0;

    this.emptyText
      ?.setVisible(this.items.length === 0)
      .setText("Your bag is empty — buy things at the shop");
    if (this.hintText) this.hintText.setVisible(this.items.length > 0);

    const rowH = 50;
    this.items.forEach((entry, i) => {
      const item = getShopItem(entry.itemId);
      if (!item) return;
      const y = this.listY + i * rowH;
      const cx = this.listX + this.listW / 2;

      const bg = this.add
        .rectangle(cx, y + 18, this.listW, 42, 0xffffff, 0.05)
        .setStrokeStyle(1, 0xffffff, 0.12);
      const glyph = this.add
        .text(this.listX + 22, y + 18, item.glyph, { fontFamily: FONT_EMOJI, fontSize: "24px" })
        .setOrigin(0.5);
      const label = this.add
        .text(this.listX + 48, y + 9, `${item.name}  ×${entry.count}`, {
          fontFamily: FONT_NARROW,
          fontSize: "15px",
          color: "#ffffff",
        })
        .setResolution(3);
      this.cards.push(bg, glyph, label);

      // Placeable items get a PLACE button while inside the house.
      if (item.placeable && this.inHouse) {
        const place = makeMenuButton(this, this.listX + this.listW - 56, y + 18, "PLACE", {
          width: 96,
          height: 32,
          onClick: () => {
            const world = this.scene.get("WorldScene") as
              | (Phaser.Scene & { beginPlacement: (id: string) => void })
              | undefined;
            world?.beginPlacement(entry.itemId);
            this.scene.stop();
          },
        });
        this.cards.push(place.container);
      }
    });
  }
}
