import { TOWN_MAP } from "../data/MapData";

// Deco indices that make up a house. When building a preset from a
// hand-authored map, every cell with one of these indices is wiped to
// -1 so the generator can stamp fresh houses there. Paths (43), trees,
// lamp posts, and small clutter are left untouched.
const HOUSE_INDICES = new Set<number>([
  // small cottage (3×3)
  96, 97, 98, 108, 109, 110, 120, 121, 122,
  // medium house with archway (43 is path, kept)
  44, 45, 56, 68, 80, 82, 94,
  // big multi-floor building
  48, 49, 50, 51, 60, 61, 62, 63, 72, 73, 75, 84, 86, 87,
  // top-right multi-building cluster
  52, 53, 54, 64, 65, 66, 67, 76, 79, 88, 89,
]);

export interface HouseSlot {
  x: number;        // top-left col of the slot bounding box
  y: number;        // top-left row
  width: number;
  height: number;
}

export interface VillagePreset {
  cols: number;
  rows: number;
  tilesetKey: string;
  tilesetCols: number;
  ground: number[][];
  deco: number[][];                       // houses stripped
  houseSlots: HouseSlot[];
  spawn: { cx: number; cy: number };
  walkableGround: ReadonlySet<number>;
  solidDeco: ReadonlySet<number>;
  flatDeco: ReadonlySet<number>;
}

function clone(layer: number[][]): number[][] {
  return layer.map(row => [...row]);
}

function stripHouses(deco: number[][]): number[][] {
  return deco.map(row =>
    row.map(idx => (idx >= 0 && HOUSE_INDICES.has(idx) ? -1 : idx)),
  );
}

// Slots sized to fit the largest house template (5×4) where possible,
// or snug around the original footprint where the surroundings are tight.
const TOWN_SLOTS: HouseSlot[] = [
  { x: 21, y: 4,  width: 7, height: 4 }, // top-right cluster
  { x: 1,  y: 7,  width: 9, height: 4 }, // left side (medium + big)
  { x: 25, y: 16, width: 4, height: 3 }, // small cottage in the south
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

// Add more presets here; the seed will pick one of them.
export const PRESETS: VillagePreset[] = [TOWN_PRESET];
