import Phaser from "phaser";
import { cartToIso, TILE_W, TILE_H } from "../utils/IsoUtils";
import {
  WALKABLE_GROUND,
  SOLID_DECO,
  GROUND_LAYER,
  DECO_LAYER,
  MAP_COLS,
  MAP_ROWS,
} from "../data/MapData";

export interface PlayerState {
  id: string;
  cx: number; // tile column
  cy: number; // tile row
  name: string;
}

const MOVE_COOLDOWN = 150; // ms between steps — feels snappier top-down

export class Player extends Phaser.GameObjects.Container {
  private sprite: Phaser.GameObjects.Rectangle;
  private nameTag: Phaser.GameObjects.Text;
  private shadow: Phaser.GameObjects.Ellipse;

  public cx: number;
  public cy: number;
  public readonly playerId: string;
  public isLocal: boolean;

  private moveCooldown = 0;

  constructor(scene: Phaser.Scene, state: PlayerState, isLocal = false) {
    // Position at tile centre
    const { x, y } = cartToIso(state.cx, state.cy);
    super(scene, x + TILE_W / 2, y + TILE_H / 2);

    this.playerId = state.id;
    this.cx = state.cx;
    this.cy = state.cy;
    this.isLocal = isLocal;

    // Shadow — flat ellipse at feet
    this.shadow = scene.add.ellipse(
      0,
      4,
      TILE_W * 0.7,
      TILE_H * 0.4,
      0x000000,
      0.25,
    );

    // Body — slightly smaller than the tile so you can see the grid
    const colour = isLocal ? 0x4fc3f7 : 0xef9a9a;
    this.sprite = scene.add.rectangle(0, 0, TILE_W - 2, TILE_H - 2, colour);

    // Name tag above
    this.nameTag = scene.add
      .text(0, -(TILE_H / 2) - 4, state.name, {
        fontSize: "6px",
        fontFamily: "monospace",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 2,
      })
      .setOrigin(0.5, 1);

    this.add([this.shadow, this.sprite, this.nameTag]);
    scene.add.existing(this);

    // Depth = row so player appears behind objects on rows below them
    this.setDepth(state.cy + 1);
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
      ease: "Linear", // linear feels right for grid-stepped top-down
    });

    this.setDepth(cy + 1);
    return true;
  }

  private canMoveToTile(cx: number, cy: number): boolean {
    if (cx < 0 || cy < 0 || cx >= MAP_COLS || cy >= MAP_ROWS) return false;
    const groundIdx = GROUND_LAYER[cy]?.[cx];
    if (groundIdx === undefined || !WALKABLE_GROUND.has(groundIdx))
      return false;
    const decoIdx = DECO_LAYER[cy]?.[cx];
    if (decoIdx !== undefined && decoIdx >= 0 && SOLID_DECO.has(decoIdx))
      return false;
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

    let dx = 0,
      dy = 0;

    // Check each axis independently so diagonals (W+A, W+D, S+A, S+D) work
    if (cursors.up!.isDown || wasd.W.isDown) {
      dy -= 1;
    }
    if (cursors.down!.isDown || wasd.S.isDown) {
      dy += 1;
    }
    if (cursors.left!.isDown || wasd.A.isDown) {
      dx -= 1;
    }
    if (cursors.right!.isDown || wasd.D.isDown) {
      dx += 1;
    }

    if (dx === 0 && dy === 0) return false;

    // For diagonals try the combined move first; if blocked try each axis alone
    // so the player slides along walls instead of getting stuck.
    let moved = false;
    if (dx !== 0 && dy !== 0) {
      moved = this.moveToTile(this.cx + dx, this.cy + dy);
      if (!moved) moved = this.moveToTile(this.cx + dx, this.cy); // try horizontal
      if (!moved) moved = this.moveToTile(this.cx, this.cy + dy); // try vertical
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
