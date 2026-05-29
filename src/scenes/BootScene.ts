import Phaser from "phaser";
import { FONT } from "../ui/theme";

const UI = "assets/kenney_ui-pack/PNG";
const SND = "assets/kenney_ui-pack/Sounds";

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "BootScene" });
  }

  preload() {
    // ── Loading bar ────────────────────────────────────────────────
    const W = this.scale.width;
    const H = this.scale.height;

    const box = this.add.graphics();
    box.fillStyle(0x1a120b, 1);
    box.fillRect(W / 2 - 160, H / 2 - 20, 320, 40);

    const bar = this.add.graphics();

    const label = this.add
      .text(W / 2, H / 2 - 36, "LOADING...", {
        fontFamily: FONT,
        fontSize: "12px",
        color: "#f0a500",
      })
      .setOrigin(0.5, 1);

    this.load.on("progress", (value: number) => {
      bar.clear();
      bar.fillStyle(0xf0a500, 1);
      bar.fillRect(W / 2 - 154, H / 2 - 14, 308 * value, 28);
    });

    this.load.on("complete", () => {
      bar.destroy();
      box.destroy();
      label.destroy();
    });

    // ── Kenney tiny-town — main city tileset ───────────────────────
    // 12 columns × 11 rows, 16×16 px tiles
    this.load.image(
      "tiles-town",
      "assets/kenney_tiny-town/Tilemap/tilemap_packed.png",
    );

    // ── Kenney tiny-battle — kept for future use ───────────────────
    this.load.image(
      "tiles-battle",
      "assets/kenney_tiny-battle/Tilemap/tilemap_packed.png",
    );

    // ── Player avatars — Kenney pixel-platformer characters ────────
    // 9 cols × 3 rows of 24×24 tiles with 1px spacing. The top row holds the
    // colourful humanoid characters we map players onto.
    this.load.spritesheet(
      "chars",
      "assets/kenney_pixel-platformer/Tilemap/tilemap-characters.png",
      { frameWidth: 24, frameHeight: 24, spacing: 1 },
    );

    // ── Kenney UI pack — nine-sliceable panels, buttons, controls ──
    this.load.image("ui-panel", `${UI}/Grey/Default/button_square_flat.png`);
    this.load.image("ui-panel-dark", `${UI}/Grey/Default/button_square_depth_flat.png`);
    this.load.image("ui-btn", `${UI}/Blue/Default/button_rectangle_depth_gloss.png`);
    this.load.image("ui-btn-down", `${UI}/Blue/Default/button_rectangle_flat.png`);
    this.load.image("ui-btn-grey", `${UI}/Grey/Default/button_rectangle_depth_gloss.png`);
    this.load.image("ui-btn-grey-down", `${UI}/Grey/Default/button_rectangle_flat.png`);
    this.load.image("ui-check-off", `${UI}/Grey/Default/check_square_grey.png`);
    this.load.image("ui-check-on", `${UI}/Blue/Default/check_square_color_checkmark.png`);
    this.load.image("ui-slide-track", `${UI}/Grey/Default/slide_horizontal_grey.png`);
    this.load.image("ui-slide-fill", `${UI}/Blue/Default/slide_horizontal_color.png`);
    this.load.image("ui-slide-handle", `${UI}/Grey/Default/slide_hangle.png`);

    // ── UI sounds ──────────────────────────────────────────────────
    this.load.audio("sfx-click", `${SND}/click-a.ogg`);
    this.load.audio("sfx-tap", `${SND}/tap-a.ogg`);
    this.load.audio("sfx-switch", `${SND}/switch-a.ogg`);
  }

  create() {
    this.scene.start("MainMenuScene");
  }
}
