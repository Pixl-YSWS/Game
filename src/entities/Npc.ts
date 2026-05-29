import Phaser from "phaser";
import { cartToIso, TILE_W, TILE_H } from "../utils/IsoUtils";
import type { NpcDef } from "../types/map";

const CHAR_SHEET = "tiles-battle";
const CHAR_COLS = 18;

function charFrame(scene: Phaser.Scene, idx: number): string {
  const key = `${CHAR_SHEET}_f${idx}`;
  const tex = scene.textures.get(CHAR_SHEET);
  if (!tex.has(key)) {
    tex.add(
      key,
      0,
      (idx % CHAR_COLS) * 16,
      Math.floor(idx / CHAR_COLS) * 16,
      16,
      16,
    );
  }
  return key;
}

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
    const sprite = scene.add.image(0, 0, CHAR_SHEET, charFrame(scene, def.sprite));
    this.nameTag = scene.add
      .text(0, -(TILE_H / 2) - 4, def.name, {
        fontSize: "8px",
        fontFamily: '"Press Start 2P"',
        color: "#ffd24a",
        stroke: "#000000",
        strokeThickness: 4,
      })
      .setOrigin(0.5, 1)
      .setResolution(4)
      .setScale(0.5);

    this.add([shadow, sprite, this.nameTag]);
    scene.add.existing(this);
    this.setDepth(def.cy + 1.5);
  }
}
