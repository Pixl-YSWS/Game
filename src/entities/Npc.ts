import Phaser from "phaser";
import { cartToIso, TILE_W, TILE_H } from "../utils/IsoUtils";
import type { NpcDef } from "../types/map";
import { FONT, CURSORS } from "../ui/theme";
import { texNpcChar, ANIM, IDLE_FRAME_MS } from "../world/cozyChar";

// Each NPC id maps to a pre-assembled character sheet (char1–char9) so every
// villager gets a unique look without paper-doll layering.
const NPC_CHAR_LOOKUP: Record<string, number> = {
  villager_quill: 1,
  villager_mara: 2,
  merchant_oda: 3,
  curator_pip: 4,
  house_innkeeper: 5,
};

function npcCharIndex(id: string): number {
  return NPC_CHAR_LOOKUP[id] ?? 1;
}

export class Npc extends Phaser.GameObjects.Container {
  public readonly def: NpcDef;
  private nameTag: Phaser.GameObjects.Text;
  private charSprite: Phaser.GameObjects.Sprite;
  private timer?: Phaser.Time.TimerEvent;

  constructor(scene: Phaser.Scene, def: NpcDef) {
    const { x, y } = cartToIso(def.cx, def.cy);
    super(scene, x + TILE_W / 2, y + TILE_H / 2);
    this.def = def;

    const shadow = scene.add.ellipse(
      0,
      5,
      TILE_W * 0.7,
      TILE_H * 0.4,
      0x000000,
      0.25,
    );

    const charN = npcCharIndex(def.id);
    const idleFrames = ANIM.idle.down;
    this.charSprite = scene.add
      .sprite(0, TILE_H / 2 + 3, texNpcChar(charN), idleFrames[0])
      .setOrigin(0.5, 1);

    let frameIdx = 0;
    this.timer = scene.time.addEvent({
      delay: IDLE_FRAME_MS,
      loop: true,
      callback: () => {
        frameIdx = (frameIdx + 1) % idleFrames.length;
        this.charSprite.setFrame(idleFrames[frameIdx]);
      },
    });

    this.nameTag = scene.add
      .text(0, -TILE_H, def.name, {
        fontSize: "16px",
        fontFamily: FONT,
        color: "#ffd24a",
        stroke: "#000000",
        strokeThickness: 5,
      })
      .setOrigin(0.5, 1)
      .setResolution(4)
      .setScale(0.34);

    this.add([shadow, this.charSprite, this.nameTag]);
    scene.add.existing(this);
    this.setDepth(def.cy + 1.5);

    this.setSize(TILE_W, TILE_H + 28);
    this.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(
        -TILE_W / 2,
        -TILE_H - 16,
        TILE_W,
        TILE_H + 28,
      ),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      cursor: CURSORS.pointer,
    });
  }

  destroy(fromScene?: boolean) {
    this.timer?.remove();
    super.destroy(fromScene);
  }
}
