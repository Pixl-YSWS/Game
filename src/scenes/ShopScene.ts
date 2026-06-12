import Phaser from "phaser";
import { SHOP_CATALOG } from "../shop/catalog";
import { gameSocket } from "../network/socket";
import { UIScene } from "./UIScene";
import { openDomModal, domBtn, el, type DomModal } from "../ui/dom";

export class ShopScene extends Phaser.Scene {
  private modal?: DomModal;
  private walletEl?: HTMLDivElement;
  private toastEl?: HTMLDivElement;
  private toastTimer?: ReturnType<typeof setTimeout>;
  private currentPixels = 0;

  constructor() {
    super({ key: "ShopScene" });
  }

  create() {
    // World keeps running behind the modal; the overlay blocks its input.
    this.events.once("shutdown", () => {
      gameSocket.off("wallet:update", this.onWalletUpdate);
      gameSocket.off("shop:result", this.onShopResult);
      clearTimeout(this.toastTimer);
      this.modal = undefined;
    });

    const ui = this.scene.get("UIScene") as UIScene | undefined;
    this.currentPixels = ui?.walletTotal ?? 0;

    this.modal = openDomModal(this, {
      title: "Shop",
      width: 720,
      onClose: () => this.scene.stop(),
    });

    this.walletEl = el("div", "pixl-sub");
    this.updateWallet();

    const list = el("div", "pixl-list");
    for (const item of SHOP_CATALOG) {
      const row = el("div", "pixl-row");
      const main = el("div", "pixl-row-main");
      main.append(
        el("div", "pixl-row-name", item.name),
        el("div", "pixl-row-meta", item.blurb ?? ""),
      );
      row.append(
        el("div", "pixl-glyph", item.glyph),
        main,
        domBtn(this, `${item.price}p · Buy`, () => gameSocket.shopBuy(item.id)),
      );
      list.append(row);
    }

    this.toastEl = el("div", "pixl-toast");
    const actions = el("div", "pixl-actions");
    actions.append(
      domBtn(this, "Close", () => this.scene.stop(), { variant: "grey", big: true }),
    );

    this.modal.body.append(this.walletEl, list, this.toastEl, actions);

    gameSocket.on("wallet:update", this.onWalletUpdate);
    gameSocket.on("shop:result", this.onShopResult);
  }

  private updateWallet() {
    if (this.walletEl)
      this.walletEl.textContent = `Wallet:  ${this.currentPixels}p`;
  }

  private onWalletUpdate = (data: { pixels: number; delta: number }) => {
    this.currentPixels = data.pixels;
    this.updateWallet();
  };

  private onShopResult = (data: {
    itemId: string;
    success: boolean;
    reason?: string;
  }) => {
    if (data.success) {
      this.flash("Bought!", "#8be98b");
    } else if (data.reason === "not_enough_pixels") {
      this.flash("Not enough pixels", "#ff8d7a");
    } else {
      this.flash(`Couldn't buy: ${data.reason}`, "#ff8d7a");
    }
  };

  private flash(msg: string, color: string) {
    if (!this.toastEl) return;
    this.toastEl.textContent = msg;
    this.toastEl.style.color = color;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      if (this.toastEl) this.toastEl.textContent = "";
    }, 1500);
  }
}
