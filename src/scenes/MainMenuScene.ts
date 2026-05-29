import Phaser from "phaser";
import { makeMenuButton } from "../utils/MenuButton";
import type { WorldRef } from "../types/network";

export class MainMenuScene extends Phaser.Scene {
  constructor() {
    super({ key: "MainMenuScene" });
  }

  create() {
    const W = this.scale.width;
    const H = this.scale.height;

    this.cameras.main.setBackgroundColor("#0d0d1a");

    // Decorative starfield pixels.
    const stars = this.add.graphics();
    stars.fillStyle(0xffffff, 0.6);
    for (let i = 0; i < 80; i++) {
      const sx = Phaser.Math.Between(0, W);
      const sy = Phaser.Math.Between(0, H);
      const r = Math.random() < 0.85 ? 1 : 2;
      stars.fillRect(sx, sy, r, r);
    }

    // Title.
    const title = this.add
      .text(W / 2, H / 2 - 140, "PIXLGAME", {
        fontFamily: '"Press Start 2P"',
        fontSize: "40px",
        color: "#f0a500",
      })
      .setOrigin(0.5)
      .setShadow(3, 3, "#000000", 0, true, true);

    this.tweens.add({
      targets: title,
      y: title.y - 6,
      duration: 1600,
      ease: "Sine.easeInOut",
      yoyo: true,
      repeat: -1,
    });

    this.add
      .text(W / 2, H / 2 - 92, "a tiny multiplayer world", {
        fontFamily: '"Press Start 2P"',
        fontSize: "9px",
        color: "#888899",
      })
      .setOrigin(0.5);

    // Buttons.
    const cx = W / 2;
    let by = H / 2 - 20;
    const STEP = 50;

    // PLAY continues from your last saved world; first-time players land
    // in their own village (server default).
    makeMenuButton(this, cx, by, "PLAY", {
      onClick: () => this.startWorld(undefined),
    });
    by += STEP;

    makeMenuButton(this, cx, by, "JOIN OPEN WORLD", {
      onClick: () => this.startWorld({ kind: "openworld" }),
    });
    by += STEP;

    makeMenuButton(this, cx, by, "SETTINGS", {
      onClick: () => this.scene.launch("SettingsScene", { from: "MainMenuScene" }),
    });

    // Footer hint.
    this.add
      .text(W / 2, H - 16, "ESC pauses the game once you're in", {
        fontFamily: '"Press Start 2P"',
        fontSize: "7px",
        color: "#555566",
      })
      .setOrigin(0.5, 1);
  }

  private startWorld(world: WorldRef | undefined) {
    this.scene.start("WorldScene", { initialWorld: world });
  }
}
