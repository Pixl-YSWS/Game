import Phaser from "phaser";
import { makeMenuButton, type MenuButton } from "../utils/MenuButton";
import { FONT, FONT_TITLE } from "../ui/theme";
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
  // Absolute (unscrolled) centre-y of this row inside the list.
  centerY: number;
}

// Overlay scene listing the shop catalog. Buying is server-validated; the
// scene reacts to wallet:update / shop:result for visual feedback. The catalog
// is longer than the panel, so the list lives in a masked, scrollable viewport.
export class ShopScene extends Phaser.Scene {
  private fromKey = "WorldScene";
  private rows: Row[] = [];
  private pixelsText?: Phaser.GameObjects.Text;
  private toast?: Phaser.GameObjects.Text;
  private currentPixels = 0;

  // Scroll viewport state.
  private content?: Phaser.GameObjects.Container;
  private scroll = 0;
  private maxScroll = 0;
  private listTop = 0;
  private listBottom = 0;
  private thumb?: Phaser.GameObjects.Rectangle;
  private thumbTrackH = 0;
  private thumbX = 0;

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

    // Keep the panel inside the canvas even on short screens.
    const panelW = 520;
    const panelH = Math.min(480, H - 48);
    const px = (W - panelW) / 2;
    const py = (H - panelH) / 2;
    panel(this, W / 2, H / 2, panelW, panelH, "ui-panel-dark");

    this.add
      .text(W / 2, py + 30, "SHOP", {
        fontFamily: FONT_TITLE,
        fontSize: "24px",
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
        fontSize: "14px",
        color: "#ffd24a",
      })
      .setOrigin(0.5);

    // ── Scrollable list viewport ─────────────────────────────────────
    const listX = px + 24;
    const listW = panelW - 48;
    this.listTop = py + 84;
    this.listBottom = py + panelH - 70; // leaves room for toast + CLOSE
    const viewportH = this.listBottom - this.listTop;

    this.content = this.add.container(0, 0);

    // A drag-to-scroll surface behind the rows (rows are added after, so they
    // win the click via Phaser's top-only input).
    this.add
      .zone(listX, this.listTop, listW, viewportH)
      .setOrigin(0, 0)
      .setInteractive({ draggable: false });

    const rowH = 56;
    for (let i = 0; i < SHOP_CATALOG.length; i++) {
      const item = SHOP_CATALOG[i];
      const centerY = this.listTop + i * rowH + rowH / 2;

      const label = this.add
        .text(listX + 6, centerY, `${item.name}\n${item.blurb ?? ""}`, {
          fontFamily: FONT,
          fontSize: "13px",
          color: "#ffffff",
          lineSpacing: 4,
        })
        .setOrigin(0, 0.5);

      const btn = makeMenuButton(
        this,
        listX + listW - 78,
        centerY,
        `${item.price}p  BUY`,
        {
          width: 140,
          height: 40,
          onClick: () => gameSocket.shopBuy(item.id),
        },
      );

      this.content.add([label, btn.container]);
      this.rows.push({ item, label, btn, centerY });
    }

    // Clip the list to the viewport.
    const maskShape = this.make.graphics({ x: 0, y: 0 });
    maskShape.fillStyle(0xffffff);
    maskShape.fillRect(listX, this.listTop, listW, viewportH);
    this.content.setMask(maskShape.createGeometryMask());

    // Scrollbar (only meaningful when the list overflows).
    const contentH = SHOP_CATALOG.length * rowH;
    this.maxScroll = Math.max(0, contentH - viewportH);
    this.thumbTrackH = viewportH;
    this.thumbX = px + panelW - 12;
    this.add
      .rectangle(this.thumbX, this.listTop, 4, viewportH, 0xffffff, 0.08)
      .setOrigin(0.5, 0);
    const thumbH = this.maxScroll > 0 ? Math.max(28, (viewportH / contentH) * viewportH) : viewportH;
    this.thumb = this.add
      .rectangle(this.thumbX, this.listTop, 4, thumbH, 0xffffff, 0.35)
      .setOrigin(0.5, 0)
      .setVisible(this.maxScroll > 0);

    // Wheel + drag scrolling.
    this.input.on(
      "wheel",
      (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
        this.setScroll(this.scroll + dy * 0.5);
      },
    );
    let dragging = false;
    let dragStartY = 0;
    let dragStartScroll = 0;
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (p.y >= this.listTop && p.y <= this.listBottom) {
        dragging = true;
        dragStartY = p.y;
        dragStartScroll = this.scroll;
      }
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (dragging && p.isDown) this.setScroll(dragStartScroll - (p.y - dragStartY));
    });
    this.input.on("pointerup", () => (dragging = false));
    this.applyScroll();

    makeMenuButton(this, W / 2, py + panelH - 34, "CLOSE", {
      variant: "grey",
      onClick: () => this.scene.stop(),
    });

    this.toast = this.add
      .text(W / 2, py + panelH - 64, "", {
        fontFamily: FONT,
        fontSize: "12px",
        color: "#ff7777",
      })
      .setOrigin(0.5);

    this.input.keyboard?.on("keydown-ESC", () => this.scene.stop());

    gameSocket.on("wallet:update", this.onWalletUpdate);
    gameSocket.on("shop:result", this.onShopResult);
  }

  private setScroll(v: number) {
    this.scroll = Phaser.Math.Clamp(v, 0, this.maxScroll);
    this.applyScroll();
  }

  // Position the content and toggle each row's visibility (invisible rows are
  // skipped by Phaser input, so scrolled-away BUY buttons aren't clickable).
  private applyScroll() {
    if (!this.content) return;
    this.content.y = -this.scroll;
    for (const row of this.rows) {
      const worldY = row.centerY - this.scroll;
      const visible = worldY + 28 > this.listTop && worldY - 28 < this.listBottom;
      row.label.setVisible(visible);
      row.btn.container.setVisible(visible);
    }
    if (this.thumb && this.maxScroll > 0) {
      const t = this.scroll / this.maxScroll;
      const travel = this.thumbTrackH - this.thumb.height;
      this.thumb.y = this.listTop + travel * t;
    }
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
