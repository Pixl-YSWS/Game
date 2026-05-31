import Phaser from "phaser";
import { cartToIso, TILE_W, TILE_H } from "../utils/IsoUtils";
import type { NpcDef } from "../types/map";
import { FONT, CURSORS } from "../ui/theme";
import { CozyAvatar } from "./CozyAvatar";
import { PRESET_OUTFITS, defaultOutfitIndex } from "../world/cozyChar";

// NPCs use the same CozyValley layered avatar as players, stood idle. Their
// look is a stable outfit derived from the NPC id so each villager is distinct
// without needing per-NPC art data.
export class Npc extends Phaser.GameObjects.Container {
  public readonly def: NpcDef;
  private nameTag: Phaser.GameObjects.Text;
  private avatar: CozyAvatar;

  constructor(scene: Phaser.Scene, def: NpcDef) {
    const { x, y } = cartToIso(def.cx, def.cy);
    super(scene, x + TILE_W / 2, y + TILE_H / 2);
    this.def = def;

    const shadow = scene.add.ellipse(0, 5, TILE_W * 0.7, TILE_H * 0.4, 0x000000, 0.25);

    this.avatar = new CozyAvatar(scene, PRESET_OUTFITS[defaultOutfitIndex(def.id)]);
    this.avatar.setPosition(0, TILE_H / 2 + 3);
    this.avatar.setAnim("idle", "down", false);

    this.nameTag = scene.add
      .text(0, -TILE_H - 12, def.name, {
        fontSize: "16px",
        fontFamily: FONT,
        color: "#ffd24a",
        stroke: "#000000",
        strokeThickness: 5,
      })
      .setOrigin(0.5, 1)
      .setResolution(4)
      .setScale(0.34);

    this.add([shadow, this.avatar, this.nameTag]);
    scene.add.existing(this);
    this.setDepth(def.cy + 1.5);

    // Clickable: hovering shows the hand cursor, clicking talks (handled by
    // WorldScene via the "pointerdown" event).
    this.setSize(TILE_W, TILE_H + 28);
    this.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(-TILE_W / 2, -TILE_H - 16, TILE_W, TILE_H + 28),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      cursor: CURSORS.pointer,
    });
  }
}
