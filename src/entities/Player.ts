import Phaser from "phaser";
import { cartToIso, TILE_W, TILE_H } from "../utils/IsoUtils";
import type { PlayerState } from "../types/network";
import type { MapDef } from "../types/map";

export type { PlayerState };

const MOVE_COOLDOWN = 150;

// tiny-battle sheet: 18 cols × 11 rows, 16×16 px tiles
// Character sprites begin at col 10; one colour group per row.
const CHAR_SHEET  = "tiles-battle";
const CHAR_COLS   = 18;
const CHAR_LOCAL  = 136; // row 7 col 10 — blue warrior
const CHAR_REMOTE = 64;  // row 3 col 10 — red warrior

function charFrame(scene: Phaser.Scene, idx: number): string {
  const key = `${CHAR_SHEET}_f${idx}`;
  const tex = scene.textures.get(CHAR_SHEET);
  if (!tex.has(key)) {
    tex.add(key, 0, (idx % CHAR_COLS) * 16, Math.floor(idx / CHAR_COLS) * 16, 16, 16);
  }
  return key;
}

export class Player extends Phaser.GameObjects.Container {
  private sprite: Phaser.GameObjects.Image;
  private nameTag: Phaser.GameObjects.Text;
  private shadow: Phaser.GameObjects.Ellipse;
  private mapDef: MapDef;

  public cx: number;
  public cy: number;
  public playerId: string;
  public isLocal: boolean;

  private moveCooldown = 0;

  constructor(scene: Phaser.Scene, state: PlayerState, isLocal: boolean, mapDef: MapDef) {
    const { x, y } = cartToIso(state.cx, state.cy);
    super(scene, x + TILE_W / 2, y + TILE_H / 2);

    this.playerId = state.id;
    this.cx = state.cx;
    this.cy = state.cy;
    this.isLocal = isLocal;
    this.mapDef = mapDef;

    this.shadow = scene.add.ellipse(0, 4, TILE_W * 0.7, TILE_H * 0.4, 0x000000, 0.25);

    const tileIdx = isLocal ? CHAR_LOCAL : CHAR_REMOTE;
    this.sprite = scene.add.image(0, 0, CHAR_SHEET, charFrame(scene, tileIdx));

    this.nameTag = scene.add
      .text(0, -(TILE_H / 2) - 4, state.name, {
        fontSize: "5px",
        fontFamily: '"Press Start 2P"',
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 2,
      })
      .setOrigin(0.5, 1);

    this.add([this.shadow, this.sprite, this.nameTag]);
    scene.add.existing(this);
    this.setDepth(state.cy + 1);
  }

  assignId(id: string) {
    this.playerId = id;
  }

  setMap(mapDef: MapDef) {
    this.mapDef = mapDef;
  }

  moveToTile(cx: number, cy: number): boolean {
    if (!this.canMoveToTile(cx, cy)) return false;

    this.cx = cx;
    this.cy = cy;

    const { x, y } = cartToIso(cx, cy);
    this.scene.tweens.add({
      targets: this,
      x: x + TILE_W / 2,
      y: y + TILE_H / 2,
      duration: MOVE_COOLDOWN - 10,
      ease: "Linear",
    });

    return true;
  }

  private canMoveToTile(cx: number, cy: number): boolean {
    const { cols, rows, groundLayer, decoLayer, walkableGround, solidDeco } = this.mapDef;
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return false;
    const groundIdx = groundLayer[cy]?.[cx];
    if (groundIdx === undefined || !walkableGround.has(groundIdx)) return false;
    const decoIdx = decoLayer[cy]?.[cx];
    if (decoIdx !== undefined && decoIdx >= 0 && solidDeco.has(decoIdx)) return false;
    return true;
  }

  handleInput(
    cursors: Phaser.Types.Input.Keyboard.CursorKeys,
    wasd: {
      W: Phaser.Input.Keyboard.Key;
      A: Phaser.Input.Keyboard.Key;
      S: Phaser.Input.Keyboard.Key;
      D: Phaser.Input.Keyboard.Key;
    },
    delta: number,
  ): boolean {
    this.moveCooldown -= delta;
    if (this.moveCooldown > 0) return false;

    let dx = 0, dy = 0;

    if (cursors.up!.isDown || wasd.W.isDown) dy -= 1;
    if (cursors.down!.isDown || wasd.S.isDown) dy += 1;
    if (cursors.left!.isDown || wasd.A.isDown) dx -= 1;
    if (cursors.right!.isDown || wasd.D.isDown) dx += 1;

    if (dx === 0 && dy === 0) return false;

    let moved = false;
    if (dx !== 0 && dy !== 0) {
      moved = this.moveToTile(this.cx + dx, this.cy + dy);
      if (!moved) moved = this.moveToTile(this.cx + dx, this.cy);
      if (!moved) moved = this.moveToTile(this.cx, this.cy + dy);
    } else {
      moved = this.moveToTile(this.cx + dx, this.cy + dy);
    }

    if (moved) this.moveCooldown = MOVE_COOLDOWN;
    return moved;
  }

  applyServerState(state: PlayerState) {
    this.moveToTile(state.cx, state.cy);
  }
}
