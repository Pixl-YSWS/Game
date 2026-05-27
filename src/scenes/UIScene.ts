import Phaser from "phaser";
import { gameSocket } from "../network/socket";
import { WorldScene } from "./WorldScene";

const PAD = 12;
const FONT = { fontFamily: "monospace", fontSize: "10px", color: "#f0e6cc" };
const FONT_DIM = { ...FONT, color: "#888877" };

export class UIScene extends Phaser.Scene {
  private worldScene!: WorldScene;
  private statusDot!: Phaser.GameObjects.Arc;
  private statusText!: Phaser.GameObjects.Text;
  private posText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: "UIScene" });
  }

  init(data: { worldScene: WorldScene }) {
    this.worldScene = data.worldScene;
  }

  create() {
    const W = this.scale.width;

    // ── Panel background (top-left) ────────────────────────────────
    this.add.rectangle(0, 0, 220, 58, 0x1a120b, 0.85).setOrigin(0, 0);

    // Game title
    this.add.text(PAD, PAD, "PIXLGAME", {
      ...FONT,
      fontSize: "13px",
      color: "#f0a500",
      fontStyle: "bold",
    });

    // Connection status
    this.statusDot = this.add.arc(PAD + 2, 38, 4, 0, 360, false, 0x888888);
    this.statusText = this.add.text(PAD + 12, 32, "OFFLINE", FONT_DIM);

    // Player position
    this.posText = this.add.text(PAD, 50, "", FONT_DIM);

    // ── Controls legend (bottom-left) ─────────────────────────────
    const H = this.scale.height;
    this.add.rectangle(0, H - 80, 200, 80, 0x1a120b, 0.82).setOrigin(0, 0);
    this.add.text(PAD, H - 76, "CONTROLS", { ...FONT, color: "#f0a500" });
    this.add.text(PAD, H - 60, "MOVE    WASD / Arrow keys", FONT_DIM);
    this.add.text(PAD, H - 48, "PAN     Drag", FONT_DIM);
    this.add.text(PAD, H - 36, "ZOOM    Scroll wheel", FONT_DIM);

    // ── Legend (bottom-right) ─────────────────────────────────────
    const legendX = W - 160;
    this.add
      .rectangle(legendX - PAD, H - 80, 160, 80, 0x1a120b, 0.82)
      .setOrigin(0, 0);
    this.add.text(legendX, H - 76, "LEGEND", { ...FONT, color: "#f0a500" });
    this.addLegendRow(legendX, H - 60, 0x8b7355, "GROUND");
    this.addLegendRow(legendX, H - 48, 0x4caf50, "DECO / OBJECTS");
    this.addLegendRow(legendX, H - 36, 0x4fc3f7, "YOU");
    this.addLegendRow(legendX, H - 24, 0xef9a9a, "OTHER PLAYERS");
  }

  update() {
    // Connection dot colour
    const connected = gameSocket.connected;
    this.statusDot.setFillStyle(connected ? 0x4caf50 : 0x888888);
    this.statusText.setText(connected ? "CONNECTED" : "OFFLINE");

    // Player tile position
    const p = this.worldScene?.getLocalPlayer();
    if (p) {
      this.posText.setText(`TILE  ${p.cx}, ${p.cy}`);
    }
  }

  private addLegendRow(x: number, y: number, colour: number, label: string) {
    this.add.rectangle(x, y + 4, 8, 8, colour).setOrigin(0, 0.5);
    this.add.text(x + 14, y, label, FONT_DIM);
  }
}
