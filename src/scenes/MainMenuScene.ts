import Phaser from "phaser";
import { makeMenuButton, attachMenuNav } from "../utils/MenuButton";
import { FONT, COLORS } from "../ui/theme";
import { getAccountName, clearSession } from "../network/playerIdentity";
import { gameSocket } from "../network/socket";
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
        fontFamily: FONT,
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
        fontFamily: FONT,
        fontSize: "9px",
        color: "#888899",
      })
      .setOrigin(0.5);

    // Buttons.
    const cx = W / 2;
    const by = H / 2 - 24;
    const STEP = 66;

    // PLAY continues from your last saved world; first-time players land
    // in their own village (server default).
    const buttons = [
      makeMenuButton(this, cx, by, "PLAY", {
        onClick: () => this.startWorld(undefined),
      }),
      makeMenuButton(this, cx, by + STEP, "JOIN OPEN WORLD", {
        onClick: () => this.startWorld({ kind: "openworld" }),
      }),
      makeMenuButton(this, cx, by + STEP * 2, "CHARACTER", {
        onClick: () => this.scene.launch("CharacterScene", { from: "MainMenuScene" }),
      }),
      makeMenuButton(this, cx, by + STEP * 3, "SETTINGS", {
        onClick: () => this.scene.launch("SettingsScene", { from: "MainMenuScene" }),
      }),
      makeMenuButton(this, cx, by + STEP * 4, "LOGOUT", {
        variant: "grey",
        onClick: () => this.logout(),
      }),
    ];
    attachMenuNav(this, buttons);

    // Signed-in identity.
    const name = getAccountName();
    if (name) {
      this.add
        .text(W / 2, H / 2 - 66, `Signed in as ${name}`, {
          fontFamily: FONT,
          fontSize: "10px",
          color: COLORS.good,
        })
        .setOrigin(0.5);
    }

    // Footer hint.
    this.add
      .text(W / 2, H - 16, "ESC pauses the game once you're in", {
        fontFamily: FONT,
        fontSize: "7px",
        color: "#555566",
      })
      .setOrigin(0.5, 1);
  }

  private startWorld(world: WorldRef | undefined) {
    this.scene.start("WorldScene", { initialWorld: world });
  }

  private logout() {
    clearSession();
    gameSocket.disconnect();
    this.scene.start("LoginScene", { message: "You've been logged out." });
  }
}
