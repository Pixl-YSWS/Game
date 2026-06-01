import { TOWN_MAP } from "../data/MapData";

const HOUSE_INDICES = new Set<number>([
  96, 97, 98, 108, 109, 110, 120, 121, 122,

  44, 45, 56, 68, 80, 82, 94,

  48, 49, 50, 51, 60, 61, 62, 63, 72, 73, 75, 84, 86, 87,

  52, 53, 54, 64, 65, 66, 67, 76, 79, 88, 89,
]);

export interface HouseSlot {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VillagePreset {
  cols: number;
  rows: number;
  tilesetKey: string;
  tilesetCols: number;
  ground: number[][];
  deco: number[][];
  houseSlots: HouseSlot[];
  spawn: { cx: number; cy: number };
  walkableGround: ReadonlySet<number>;
  solidDeco: ReadonlySet<number>;
  flatDeco: ReadonlySet<number>;
}

function clone(layer: number[][]): number[][] {
  return layer.map((row) => [...row]);
}

function stripHouses(deco: number[][]): number[][] {
  return deco.map((row) =>
    row.map((idx) => (idx >= 0 && HOUSE_INDICES.has(idx) ? -1 : idx)),
  );
}

const TOWN_SLOTS: HouseSlot[] = [
  { x: 21, y: 4, width: 7, height: 4 },
  { x: 1, y: 7, width: 9, height: 4 },
  { x: 25, y: 16, width: 4, height: 3 },
];

export const TOWN_PRESET: VillagePreset = {
  cols: TOWN_MAP.cols,
  rows: TOWN_MAP.rows,
  tilesetKey: TOWN_MAP.tilesetKey,
  tilesetCols: TOWN_MAP.tilesetCols,
  ground: clone(TOWN_MAP.groundLayer),
  deco: stripHouses(TOWN_MAP.decoLayer),
  houseSlots: TOWN_SLOTS,
  spawn: { cx: TOWN_MAP.spawnPoint.cx, cy: TOWN_MAP.spawnPoint.cy },
  walkableGround: TOWN_MAP.walkableGround,
  solidDeco: TOWN_MAP.solidDeco,
  flatDeco: TOWN_MAP.flatDeco,
};

export const PRESETS: VillagePreset[] = [TOWN_PRESET];
