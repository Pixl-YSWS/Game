import Phaser from "phaser";
import { IsoMap } from "../world/IsoMap";
import { Player } from "../entities/Player";
import { TILE_H } from "../utils/IsoUtils";
import type { MapDef } from "../types/map";

// Placeholder interior: a 10×8 room with walls and a single exit tile at
// the south-middle. The real interior maps will replace this later; the
// scene just needs to exist so the door transition works end-to-end.
const COLS = 10;
const ROWS = 8;

function makeInteriorMap(): MapDef {
  // Floor: cobblestone (ground tile 1) inside the room.
  const ground = Array.from({ length: ROWS }, () => new Array(COLS).fill(1));
  const deco = Array.from({ length: ROWS }, () => new Array(COLS).fill(-1));

  // Walls around the perimeter; door (43, walkable) at south-middle.
  const doorCol = Math.floor(COLS / 2);
  for (let c = 0; c < COLS; c++) {
    deco[0][c] = 45;              // top wall
    if (c !== doorCol) deco[ROWS - 1][c] = 68; // bottom wall
  }
  for (let r = 1; r < ROWS - 1; r++) {
    deco[r][0] = 56;              // left wall
    deco[r][COLS - 1] = 80;       // right wall
  }
  deco[ROWS - 1][doorCol] = 43;   // exit tile

  return {
    key: "interior_default",
    cols: COLS,
    rows: ROWS,
    tilesetKey: "tiles-town",
    tilesetCols: 12,
    groundLayer: ground,
    decoLayer: deco,
    walkableGround: new Set([0, 1, 2]),
    solidDeco: new Set([44, 45, 56, 68, 80, 82, 94]),
    flatDeco: new Set([43]),
    spawnPoint: { cx: doorCol, cy: ROWS - 2 }, // just inside the door
    doors: [],
  };
}

interface InteriorInitData {
  returnTo: { cx: number; cy: number };
}

export class InteriorScene extends Phaser.Scene {
  private localPlayer?: Player;
  private mapDef?: MapDef;
  private returnTo!: { cx: number; cy: number };
  private exitTile!: { cx: number; cy: number };
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };
  private exiting = false;

  constructor() {
    super({ key: "InteriorScene" });
  }

  init(data: InteriorInitData) {
    this.returnTo = data.returnTo;
    this.exiting = false;
  }

  create() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = {
      W: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      A: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      S: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      D: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };

    this.mapDef = makeInteriorMap();
    const isoMap = new IsoMap(this, this.mapDef);
    isoMap.build();

    const cam = this.cameras.main;
    cam.centerOn(isoMap.centre.x, isoMap.centre.y);
    cam.setZoom(4);
    cam.setBounds(
      isoMap.boundsX, isoMap.boundsY,
      isoMap.boundsW, isoMap.boundsH,
    );

    const { cx, cy } = this.mapDef.spawnPoint;
    this.localPlayer = new Player(
      this,
      { id: "local", cx, cy, name: "You" },
      true,
      this.mapDef,
    );
    cam.startFollow(this.localPlayer, true, 0.08, 0.08);

    this.exitTile = { cx: Math.floor(COLS / 2), cy: ROWS - 1 };
  }

  update(_time: number, delta: number) {
    if (!this.localPlayer) return;
    this.localPlayer.handleInput(this.cursors, this.wasd, delta);
    this.localPlayer.setDepth(Math.floor(this.localPlayer.y / TILE_H) + 1.5);

    if (this.exiting) return;
    if (
      this.localPlayer.cx === this.exitTile.cx &&
      this.localPlayer.cy === this.exitTile.cy
    ) {
      this.exiting = true;
      this.scene.stop();
      this.scene.resume("WorldScene", { returnTo: this.returnTo });
    }
  }
}
