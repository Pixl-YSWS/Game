import Phaser from "phaser";
import { Button, panel, closeButton, fitModal } from "../ui/UIKit";
import { FONT, FONT_TITLE, COLORS } from "../ui/theme";
import { CHAR_BASES } from "../entities/Player";
import { getCharIndex, setCharIndex } from "../network/playerIdentity";
import { gameSocket } from "../network/socket";

interface CharInit {
  from?: string;
}

// Overlay scene to pick your character skin. Saved locally + pushed to the
// server (which persists it on your account and tells other players).
export class CharacterScene extends Phaser.Scene {
  private fromKey?: string;
  private selected = 0;
  private highlight?: Phaser.GameObjects.Rectangle;
  private slots: { x: number; y: number }[] = [];

  constructor() {
    super({ key: "CharacterScene" });
  }

  init(data: CharInit) {
    this.fromKey = data?.from;
  }

  create() {
    if (this.fromKey) this.scene.pause(this.fromKey);
    this.events.once("shutdown", () => {
      if (this.fromKey) this.scene.resume(this.fromKey);
    });

    const W = this.scale.width;
    const H = this.scale.height;

    this.add.zone(0, 0, W, H).setOrigin(0).setInteractive();

    const panelW = 480;
    const panelH = 260;
    panel(this, W / 2, H / 2, panelW, panelH, "ui-panel-dark");
    closeButton(this, W / 2 + panelW / 2 - 26, H / 2 - panelH / 2 + 24, () => this.scene.stop());
    fitModal(this, panelW, panelH);

    this.add
      .text(W / 2, H / 2 - 92, "CHOOSE YOUR LOOK", {
        fontFamily: FONT_TITLE,
        fontSize: "18px",
        color: "#f0a500",
      })
      .setOrigin(0.5);

    this.selected = getCharIndex();
    if (this.selected < 0 || this.selected >= CHAR_BASES.length) this.selected = 0;

    // Row of character previews.
    const n = CHAR_BASES.length;
    const gap = 76;
    const startX = W / 2 - ((n - 1) * gap) / 2;
    const rowY = H / 2 - 6;

    this.highlight = this.add
      .rectangle(startX, rowY, 60, 70, 0xffd166, 0.18)
      .setStrokeStyle(2, 0xffd166, 0.9);

    CHAR_BASES.forEach((frame, i) => {
      const x = startX + i * gap;
      this.slots.push({ x, y: rowY });
      this.add
        .image(x, rowY, "chars", frame)
        .setScale(2.4)
        .setInteractive({ cursor: "pointer" })
        .on("pointerdown", () => this.select(i));
    });

    this.add
      .text(W / 2, H / 2 + 48, "Click a character to pick it", {
        fontFamily: FONT,
        fontSize: "9px",
        color: COLORS.textDim,
      })
      .setOrigin(0.5);

    new Button(this, W / 2, H / 2 + 92, "DONE", {
      width: 200,
      height: 48,
      onClick: () => this.scene.stop(),
    });

    this.select(this.selected);

    this.input.keyboard?.on("keydown-ESC", () => this.scene.stop());
  }

  private select(i: number) {
    this.selected = i;
    const slot = this.slots[i];
    if (this.highlight && slot) this.highlight.setPosition(slot.x, slot.y);
    setCharIndex(i);
    // Apply live if we're already in a game; otherwise it syncs on next connect.
    if (gameSocket.connected) gameSocket.setCharacter(i);
  }
}
