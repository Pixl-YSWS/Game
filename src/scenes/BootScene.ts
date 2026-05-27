import Phaser from "phaser";

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
        fontFamily: "monospace",
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

    // ── Player spritesheet ─────────────────────────────────────────
    // Replace with real asset when ready:
    //   public/assets/player.png — 16×16 frames, 4 frames walk cycle per direction
    // For now we use a coloured rectangle in Player.ts as placeholder.
  }

  create() {
    this.scene.start("WorldScene");
  }
}
