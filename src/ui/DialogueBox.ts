import Phaser from "phaser";

interface DialogueState {
  speaker: string;
  lines: string[];
  index: number;
}

// Bottom-of-screen dialogue panel. Rendered as separate scene-level objects
// (not in a Container) so they correctly inherit the `setScrollFactor(0)`
// HUD behavior of the WorldScene — Containers reapply the camera zoom in a
// way that pushes a 1280×720-positioned panel off-screen.
export class DialogueBox {
  private state?: DialogueState;
  private bg: Phaser.GameObjects.Graphics;
  private speakerText: Phaser.GameObjects.Text;
  private bodyText: Phaser.GameObjects.Text;
  private hintText: Phaser.GameObjects.Text;

  private readonly W = 760;
  private readonly H = 130;

  constructor(scene: Phaser.Scene) {
    const screenW = scene.scale.width;
    const screenH = scene.scale.height;
    const x = (screenW - this.W) / 2;
    const y = screenH - this.H - 16;

    this.bg = scene.add.graphics();
    this.bg.fillStyle(0x000000, 0.82);
    this.bg.fillRect(x, y, this.W, this.H);
    this.bg.lineStyle(2, 0xf0a500, 1);
    this.bg.strokeRect(x, y, this.W, this.H);
    this.bg.setScrollFactor(0).setDepth(10000).setVisible(false);

    this.speakerText = scene.add
      .text(x + 14, y + 10, "", {
        fontFamily: '"Press Start 2P"',
        fontSize: "12px",
        color: "#ffd24a",
      })
      .setScrollFactor(0)
      .setDepth(10001)
      .setVisible(false);

    this.bodyText = scene.add
      .text(x + 14, y + 40, "", {
        fontFamily: '"Press Start 2P"',
        fontSize: "10px",
        color: "#ffffff",
        wordWrap: { width: this.W - 28 },
        lineSpacing: 6,
      })
      .setScrollFactor(0)
      .setDepth(10001)
      .setVisible(false);

    this.hintText = scene.add
      .text(x + this.W - 14, y + this.H - 10, "[E] next", {
        fontFamily: '"Press Start 2P"',
        fontSize: "8px",
        color: "#888899",
      })
      .setOrigin(1, 1)
      .setScrollFactor(0)
      .setDepth(10001)
      .setVisible(false);
  }

  get isOpen(): boolean {
    return this.state !== undefined;
  }

  open(speaker: string, lines: string[]) {
    if (lines.length === 0) return;
    this.state = { speaker, lines, index: 0 };
    this.speakerText.setText(speaker);
    this.bodyText.setText(lines[0]);
    this.hintText.setText(lines.length > 1 ? "[E] next" : "[E] close");
    this.setVisible(true);
  }

  // Advance to the next line, or close if at the last line. Returns true if
  // the box is still open after this call.
  advance(): boolean {
    if (!this.state) return false;
    this.state.index += 1;
    if (this.state.index >= this.state.lines.length) {
      this.close();
      return false;
    }
    const line = this.state.lines[this.state.index];
    this.bodyText.setText(line);
    const last = this.state.index === this.state.lines.length - 1;
    this.hintText.setText(last ? "[E] close" : "[E] next");
    return true;
  }

  close() {
    this.state = undefined;
    this.setVisible(false);
  }

  destroy() {
    this.bg.destroy();
    this.speakerText.destroy();
    this.bodyText.destroy();
    this.hintText.destroy();
  }

  private setVisible(v: boolean) {
    this.bg.setVisible(v);
    this.speakerText.setVisible(v);
    this.bodyText.setVisible(v);
    this.hintText.setVisible(v);
  }
}
