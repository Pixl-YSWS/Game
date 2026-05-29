import type { MapDef } from "../types/map";

// 16:9 so the interior fills the 1280×720 canvas at the auto-fit zoom.
const COLS = 32;
const ROWS = 18;
// Room takes up most of the map now — only a thin grass border around it.
const ROOM_COLS = 24;
const ROOM_ROWS = 14;
const ROOM_X = Math.floor((COLS - ROOM_COLS) / 2);
const ROOM_Y = Math.floor((ROWS - ROOM_ROWS) / 2);
const DOOR_COL = ROOM_X + Math.floor(ROOM_COLS / 2);
const DOOR_ROW = ROOM_Y + ROOM_ROWS - 1;

// Tile position of the doorway. The same tile acts as both the spawn-adjacent
// entry from the open world and the "press E here to leave" exit.
export const HOUSE_DOOR = { cx: DOOR_COL, cy: DOOR_ROW } as const;

// Single shared house interior. Server and WorldScene both build the same
// MapDef from this so movements stay in sync across clients.
export function makeHouseInterior(): MapDef {
  const ground = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
  const deco = Array.from({ length: ROWS }, () => new Array(COLS).fill(-1));

  // Cobblestone room floor.
  for (let r = ROOM_Y; r <= ROOM_Y + ROOM_ROWS - 1; r++) {
    for (let c = ROOM_X; c <= ROOM_X + ROOM_COLS - 1; c++) {
      ground[r][c] = 1;
    }
  }

  // Walls around the room.
  for (let c = ROOM_X; c < ROOM_X + ROOM_COLS; c++) {
    deco[ROOM_Y][c] = 45;
    if (c !== DOOR_COL) deco[DOOR_ROW][c] = 68;
  }
  for (let r = ROOM_Y + 1; r < DOOR_ROW; r++) {
    deco[r][ROOM_X] = 56;
    deco[r][ROOM_X + ROOM_COLS - 1] = 80;
  }
  deco[DOOR_ROW][DOOR_COL] = 43; // doorway

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
        sprite: 2, // chars sheet — idle frame
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
