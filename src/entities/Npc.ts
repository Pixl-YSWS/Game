import Phaser from "phaser";
import { cartToIso, TILE_W, TILE_H } from "../utils/IsoUtils";
import type { NpcDef } from "../types/map";
import { FONT, CURSORS } from "../ui/theme";

// NPCs share the Kenney pixel-platformer "chars" sheet with players; `sprite`
// is a frame index into it (24×24, 1px spacing).
const CHAR_SHEET = "chars";

export class Npc extends Phaser.GameObjects.Container {
  public readonly def: NpcDef;
  private nameTag: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, def: NpcDef) {
    const { x, y } = cartToIso(def.cx, def.cy);
    super(scene, x + TILE_W / 2, y + TILE_H / 2);
    this.def = def;

    const shadow = scene.add.ellipse(
      0,
      4,
      TILE_W * 0.7,
      TILE_H * 0.4,
      0x000000,
      0.25,
    );
    // Match the player avatar footprint: stand on the tile, feet-aligned.
    const sprite = scene.add
      .image(0, TILE_H / 2 + 2, CHAR_SHEET, def.sprite)
      .setOrigin(0.5, 1);
    this.nameTag = scene.add
      .text(0, -TILE_H - 2, def.name, {
        fontSize: "16px",
        fontFamily: FONT,
        color: "#ffd24a",
        stroke: "#000000",
        strokeThickness: 5,
      })
      .setOrigin(0.5, 1)
      .setResolution(4)
      .setScale(0.34);

    this.add([shadow, sprite, this.nameTag]);
    scene.add.existing(this);
    this.setDepth(def.cy + 1.5);

    // Clickable: hovering shows the hand cursor, clicking talks (handled by
    // WorldScene via the "pointerdown" event).
    this.setSize(TILE_W, TILE_H + 12);
    this.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(-TILE_W / 2, -TILE_H, TILE_W, TILE_H + 12),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      cursor: CURSORS.pointer,
    });
  }
}
