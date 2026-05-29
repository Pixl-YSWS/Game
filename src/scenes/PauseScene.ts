import Phaser from "phaser";
import { makeMenuButton } from "../utils/MenuButton";
import { FONT } from "../ui/theme";
import { panel } from "../ui/UIKit";
import { gameSocket } from "../network/socket";

interface PauseInit {
  pausedSceneKey: string;
}

export class PauseScene extends Phaser.Scene {
  private pausedSceneKey = "WorldScene";

  constructor() {
    super({ key: "PauseScene" });
  }

  init(data: PauseInit) {
    this.pausedSceneKey = data?.pausedSceneKey ?? "WorldScene";
  }

  create() {
    const W = this.scale.width;
    const H = this.scale.height;

    const overlay = this.add.graphics();
    overlay.fillStyle(0x000000, 0.7);
    overlay.fillRect(0, 0, W, H);

    // Menu panel.
    panel(this, W / 2, H / 2 - 6, 380, 380, "ui-panel-dark");

    this.add
      .text(W / 2, H / 2 - 130, "PAUSED", {
        fontFamily: FONT,
        fontSize: "30px",
        color: "#f0a500",
      })
      .setOrigin(0.5)
      .setShadow(3, 3, "#000000", 0, true, true);

    const cx = W / 2;
    let by = H / 2 - 50;
    const STEP = 66;

    makeMenuButton(this, cx, by, "RESUME", {
      onClick: () => this.resume(),
    });
    by += STEP;

    makeMenuButton(this, cx, by, "SETTINGS", {
      onClick: () => this.scene.launch("SettingsScene", { from: "PauseScene" }),
    });
    by += STEP;

    makeMenuButton(this, cx, by, "CHARACTER", {
      onClick: () => this.scene.launch("CharacterScene", { from: "PauseScene" }),
    });
    by += STEP;

    makeMenuButton(this, cx, by, "QUIT TO MAIN MENU", {
      onClick: () => this.quitToMenu(),
    });

    this.add
      .text(W / 2, H - 16, "press ESC to resume", {
        fontFamily: FONT,
        fontSize: "10px",
        color: "#888899",
      })
      .setOrigin(0.5, 1);

    this.input.keyboard?.on("keydown-ESC", () => this.resume());
  }

  private resume() {
    this.scene.stop("SettingsScene");
    this.scene.resume(this.pausedSceneKey);
    this.scene.stop();
  }

  private quitToMenu() {
    this.scene.stop("SettingsScene");
    // Stop both gameplay scenes so the main menu starts clean.
    this.scene.stop("InteriorScene");
    this.scene.stop("WorldScene");
    gameSocket.disconnect();
    this.scene.start("MainMenuScene");
    this.scene.stop();
  }
}
