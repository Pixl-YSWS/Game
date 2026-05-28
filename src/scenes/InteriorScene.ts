import Phaser from "phaser";
import { IsoMap } from "../world/IsoMap";
import { Player } from "../entities/Player";
import { TILE_H } from "../utils/IsoUtils";
import type { MapDef } from "../types/map";

const ROOM_COLS = 10;
const ROOM_ROWS = 8;
const COLS = 32;
const ROWS = 18;
const ROOM_X = 11;
const ROOM_Y = 4;
const DOOR_COL = ROOM_X + Math.floor(ROOM_COLS / 2);
const DOOR_ROW = ROOM_Y + ROOM_ROWS - 1;

function makeInteriorMap(): MapDef {
  const ground = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
  const deco = Array.from({ length: ROWS }, () => new Array(COLS).fill(-1));

  // Room floor: cobblestone
  for (let r = ROOM_Y; r <= ROOM_Y + ROOM_ROWS - 1; r++) {
    for (let c = ROOM_X; c <= ROOM_X + ROOM_COLS - 1; c++) {
      ground[r][c] = 1;
    }
  }

  // Walls around the room
  for (let c = ROOM_X; c < ROOM_X + ROOM_COLS; c++) {
    deco[ROOM_Y][c] = 45;
    if (c !== DOOR_COL) deco[DOOR_ROW][c] = 68;
  }
  for (let r = ROOM_Y + 1; r < DOOR_ROW; r++) {
    deco[r][ROOM_X] = 56;
    deco[r][ROOM_X + ROOM_COLS - 1] = 80;
  }
  deco[DOOR_ROW][DOOR_COL] = 43; // door

  // Stone path leading south from the door
  for (let r = DOOR_ROW + 1; r < ROWS; r++) {
    deco[r][DOOR_COL] = 43;
  }

  // Garden decorations around the building
  // Top
  deco[1][5] = 4; deco[2][5] = 16;
  deco[1][15] = 15;
  deco[2][20] = 3;
  deco[1][26] = 4; deco[2][26] = 16;
  deco[3][28] = 27;

  // Left
  deco[8][2] = 4; deco[9][2] = 16;
  deco[10][3] = 7;
  deco[12][4] = 28;

  // Right
  deco[8][29] = 4; deco[9][29] = 16;
  deco[10][28] = 7;

  // Bottom (besides the path)
  deco[14][4] = 3;
  deco[15][28] = 15;
  deco[16][8] = 4; deco[17][8] = 16;
  deco[16][25] = 27;

  return {
    key: "interior_default",
    cols: COLS,
    rows: ROWS,
    tilesetKey: "tiles-town",
    tilesetCols: 12,
    groundLayer: ground,
    decoLayer: deco,
    walkableGround: new Set([0, 1, 2]),
    solidDeco: new Set([44, 45, 56, 68, 80, 82, 94, 4, 16, 7, 3, 15, 27, 28]),
    flatDeco: new Set([43, 3, 15, 27, 28]),
    spawnPoint: { cx: DOOR_COL, cy: DOOR_ROW - 1 },
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
    cam.setZoom(Math.min(
      this.scale.width / isoMap.boundsW,
      this.scale.height / isoMap.boundsH,
    ));
    cam.centerOn(isoMap.centre.x, isoMap.centre.y);

    const { cx, cy } = this.mapDef.spawnPoint;
    this.localPlayer = new Player(
      this,
      { id: "local", cx, cy, name: "You" },
      true,
      this.mapDef,
    );
    cam.startFollow(this.localPlayer, true, 0.08, 0.08);

    this.exitTile = { cx: DOOR_COL, cy: DOOR_ROW };
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
