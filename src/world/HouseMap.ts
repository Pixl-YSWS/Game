// MOSTLY WRITTEN BY CLAUDE
// MAP STUFF IS MOSTLY WRITTEN BY CLAUDE

import type { MapDef } from "../types/map";

const COLS = 32;
const ROWS = 18;

const ROOM_COLS = 24;
const ROOM_ROWS = 14;
const ROOM_X = Math.floor((COLS - ROOM_COLS) / 2);
const ROOM_Y = Math.floor((ROWS - ROOM_ROWS) / 2);
const DOOR_COL = ROOM_X + Math.floor(ROOM_COLS / 2);
const DOOR_ROW = ROOM_Y + ROOM_ROWS - 1;

export const HOUSE_DOOR = { cx: DOOR_COL, cy: DOOR_ROW } as const;

export function makeHouseInterior(): MapDef {
  const ground = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
  const deco = Array.from({ length: ROWS }, () => new Array(COLS).fill(-1));

  for (let r = ROOM_Y; r <= ROOM_Y + ROOM_ROWS - 1; r++) {
    for (let c = ROOM_X; c <= ROOM_X + ROOM_COLS - 1; c++) {
      ground[r][c] = 1;
    }
  }

  for (let c = ROOM_X; c < ROOM_X + ROOM_COLS; c++) {
    deco[ROOM_Y][c] = 45;
    if (c !== DOOR_COL) deco[DOOR_ROW][c] = 68;
  }
  for (let r = ROOM_Y + 1; r < DOOR_ROW; r++) {
    deco[r][ROOM_X] = 56;
    deco[r][ROOM_X + ROOM_COLS - 1] = 80;
  }
  deco[DOOR_ROW][DOOR_COL] = 43;

  return {
    key: "house_shared",
    cols: COLS,
    rows: ROWS,
    tilesetKey: "tiles-town",
    tilesetCols: 12,
    groundLayer: ground,
    decoLayer: deco,
    walkableGround: new Set([0, 1, 2]),
    solidDeco: new Set([44, 45, 56, 68, 80, 82, 94]),
    flatDeco: new Set([43]),
    spawnPoint: { cx: DOOR_COL, cy: DOOR_ROW - 1 },
    doors: [{ cx: DOOR_COL, cy: DOOR_ROW }],
    npcs: [
      {
        id: "house_innkeeper",
        cx: ROOM_X + 1,
        cy: ROOM_Y + 2,
        name: "Innkeeper",
        sprite: 2,
        dialogue: [
          "Welcome to the shared house.",
          "Other players you meet here are real — wave at them.",
          "Here's some pixels to get you started.",
        ],
        reward: 10,
      },
    ],
  };
}
