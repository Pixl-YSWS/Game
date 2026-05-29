import Phaser from "phaser";
import { makeMenuButton, type MenuButton } from "../utils/MenuButton";
import { FONT } from "../ui/theme";
import { panel } from "../ui/UIKit";
import { SHOP_CATALOG, type ShopItem } from "../shop/catalog";
import { gameSocket } from "../network/socket";
import { UIScene } from "./UIScene";

interface ShopInit {
  // The scene to pause while the shop is open and resume on close.
  from: string;
}

interface Row {
  item: ShopItem;
  label: Phaser.GameObjects.Text;
  btn: MenuButton;
}

// Overlay scene listing the shop catalog. Buying is server-validated; the
// scene reacts to wallet:update / shop:result for visual feedback.
export class ShopScene extends Phaser.Scene {
  private fromKey = "WorldScene";
  private rows: Row[] = [];
  private pixelsText?: Phaser.GameObjects.Text;
  private toast?: Phaser.GameObjects.Text;
  private currentPixels = 0;

  constructor() {
    super({ key: "ShopScene" });
  }

  init(data: ShopInit) {
    this.fromKey = data?.from ?? "WorldScene";
  }

  create() {
    const W = this.scale.width;
    const H = this.scale.height;

    // Pause the launching scene so its input doesn't leak through.
    this.scene.pause(this.fromKey);
    this.events.once("shutdown", () => {
      this.scene.resume(this.fromKey);
      gameSocket.off("wallet:update", this.onWalletUpdate);
      gameSocket.off("shop:result", this.onShopResult);
    });

    const overlay = this.add.graphics();
    overlay.fillStyle(0x000000, 0.78);
    overlay.fillRect(0, 0, W, H);
    this.add.zone(0, 0, W, H).setOrigin(0).setInteractive();

    const panelW = 540;
    const panelH = 460;
    const px = (W - panelW) / 2;
    const py = (H - panelH) / 2;
    panel(this, W / 2, H / 2, panelW, panelH, "ui-panel-dark");

    this.add
      .text(W / 2, py + 30, "SHOP", {
        fontFamily: FONT,
        fontSize: "22px",
        color: "#f0a500",
      })
      .setOrigin(0.5);

    // Read the current pixel count from the running UI scene so the shop's
    // header starts in sync; live updates come via wallet:update below.
    const ui = this.scene.get("UIScene") as UIScene | undefined;
    this.currentPixels = ui?.walletTotal ?? 0;

    this.pixelsText = this.add
      .text(W / 2, py + 58, `Wallet:  ${this.currentPixels}p`, {
        fontFamily: FONT,
        fontSize: "13px",
        color: "#ffd24a",
      })
      .setOrigin(0.5);

    // One row per catalog item.
    const rowH = 52;
    let rowY = py + 96;
    for (const item of SHOP_CATALOG) {
      const label = this.add.text(
        px + 32,
        rowY + 6,
        `${item.name}\n${item.blurb ?? ""}`,
        {
          fontFamily: FONT,
          fontSize: "11px",
          color: "#ffffff",
          lineSpacing: 5,
        },
      );
      const btn = makeMenuButton(
        this,
        px + panelW - 100,
        rowY + 18,
        `${item.price}p  BUY`,
        {
          width: 150,
          height: 44,
          onClick: () => gameSocket.shopBuy(item.id),
        },
      );
      this.rows.push({ item, label, btn });
      rowY += rowH + 8;
    }

    makeMenuButton(this, W / 2, py + panelH - 40, "CLOSE", {
      variant: "grey",
      onClick: () => this.scene.stop(),
    });

    this.toast = this.add
      .text(W / 2, py + panelH - 84, "", {
        fontFamily: FONT,
        fontSize: "11px",
        color: "#ff7777",
      })
      .setOrigin(0.5);

    this.input.keyboard?.on("keydown-ESC", () => this.scene.stop());

    gameSocket.on("wallet:update", this.onWalletUpdate);
    gameSocket.on("shop:result", this.onShopResult);
  }

  private onWalletUpdate = (data: { pixels: number; delta: number }) => {
    this.currentPixels = data.pixels;
    this.pixelsText?.setText(`Wallet:  ${this.currentPixels}p`);
  };

  private onShopResult = (data: { itemId: string; success: boolean; reason?: string }) => {
    if (data.success) {
      this.flash(`Bought!`, "#7dda1c");
    } else if (data.reason === "not_enough_pixels") {
      this.flash(`Not enough pixels`, "#ff7777");
    } else {
      this.flash(`Couldn't buy: ${data.reason}`, "#ff7777");
    }
  };

  private flash(msg: string, color: string) {
    if (!this.toast) return;
    this.toast.setColor(color);
    this.toast.setText(msg);
    this.time.delayedCall(1200, () => this.toast?.setText(""));
  }
}
