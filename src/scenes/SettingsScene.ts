import Phaser from "phaser";
import { makeMenuButton, type MenuButton } from "../utils/MenuButton";
import { loadSettings, saveSettings, ZOOM_OPTIONS } from "../data/Settings";

interface SettingsInit {
  from?: string;
}

export class SettingsScene extends Phaser.Scene {
  private zoomBtn?: MenuButton;
  private soundBtn?: MenuButton;
  private fromKey?: string;

  constructor() {
    super({ key: "SettingsScene" });
  }

  init(data: SettingsInit) {
    this.fromKey = data?.from;
  }

  create() {
    // Pause the launching scene so its buttons don't keep receiving hover
    // events while Settings is on top of them.
    if (this.fromKey) this.scene.pause(this.fromKey);
    this.events.once("shutdown", () => {
      if (this.fromKey) this.scene.resume(this.fromKey);
    });

    const W = this.scale.width;
    const H = this.scale.height;

    // Dim backdrop (this scene runs as an overlay when launched from pause).
    const overlay = this.add.graphics();
    overlay.fillStyle(0x000000, 0.78);
    overlay.fillRect(0, 0, W, H);
    // Eat clicks so they don't reach buttons in the paused scene underneath.
    this.add
      .zone(0, 0, W, H)
      .setOrigin(0)
      .setInteractive();

    // Panel.
    const panelW = 360;
    const panelH = 280;
    const px = (W - panelW) / 2;
    const py = (H - panelH) / 2;
    const panel = this.add.graphics();
    panel.fillStyle(0x161624, 1);
    panel.fillRect(px, py, panelW, panelH);
    panel.lineStyle(2, 0xf0a500, 1);
    panel.strokeRect(px, py, panelW, panelH);

    this.add
      .text(W / 2, py + 26, "SETTINGS", {
        fontFamily: '"Press Start 2P"',
        fontSize: "16px",
        color: "#f0a500",
      })
      .setOrigin(0.5);

    const cx = W / 2;
    let by = py + 80;
    const STEP = 50;

    this.zoomBtn = makeMenuButton(this, cx, by, this.zoomLabel(), {
      onClick: () => this.cycleZoom(),
    });
    by += STEP;

    this.soundBtn = makeMenuButton(this, cx, by, this.soundLabel(), {
      onClick: () => this.toggleSound(),
    });
    by += STEP + 16;

    makeMenuButton(this, cx, by, "BACK", {
      onClick: () => this.scene.stop(),
    });

    this.input.keyboard?.on("keydown-ESC", () => this.scene.stop());
  }

  private zoomLabel(): string {
    return `ZOOM:  ${loadSettings().defaultZoom}x`;
  }

  private soundLabel(): string {
    return `SOUND:  ${loadSettings().soundEnabled ? "ON" : "OFF"}`;
  }

  private cycleZoom() {
    const s = loadSettings();
    const idx = ZOOM_OPTIONS.indexOf(s.defaultZoom);
    const next = ZOOM_OPTIONS[(idx + 1) % ZOOM_OPTIONS.length];
    saveSettings({ ...s, defaultZoom: next });
    this.zoomBtn?.setText(this.zoomLabel());
  }

  private toggleSound() {
    const s = loadSettings();
    saveSettings({ ...s, soundEnabled: !s.soundEnabled });
    this.soundBtn?.setText(this.soundLabel());
  }
}
