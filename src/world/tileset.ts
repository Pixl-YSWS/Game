import type { MapObject } from "../types/map";

// ── CozyValley world tile registry ───────────────────────────────────────
// The cozy art is spread across many PNGs, so map layers store small numeric
// tile ids that resolve to (sheet, frame) here. Ground/flat-deco ids render
// 16×16 cells; trees and houses are MapObjects (multi-tile sprites). This file
// is Phaser-free so the server can import the walkability sets.

// Texture keys (loaded in BootScene).
export const TS = {
  terrain: "cv-terrain",
  water: "cv-water",
  flowers: "cv-flowers",
  grounddecor: "cv-grounddecor",
  trees: "cv-trees",
  houses: "cv-houses",
  soil: "cv-soil",
  crops: "cv-crops",
  fence: "cv-fence",
} as const;

const P = "assets/CozyValley_Premium_1.3/CozyValley_Premium_1.3/Tilesets";
const B = "assets/CozyValley_Basic_1.0/CozyValley_Basic_1.0/Tilesets";
const EX = "assets/CozyTowns_v1/Housing/Exterior";

export interface SheetSpec { key: string; path: string }
export const worldSheetSpecs: SheetSpec[] = [
  { key: TS.terrain, path: `${P}/Terrain.png` },
  { key: TS.water, path: `${P}/Water.png` },
  { key: TS.flowers, path: `${P}/Flowers.png` },
  { key: TS.grounddecor, path: `${P}/Grounddecor.png` },
  { key: TS.trees, path: `${B}/BASIC_propsNature.png` },
  { key: TS.houses, path: `${EX}/Houses.png` },
  { key: TS.soil, path: `${P}/Soil.png` },
  { key: TS.crops, path: `${P}/Crops/Crops_carrot.png` },
  { key: TS.fence, path: `${P}/Woodenfence.png` },
];

// ── Tile ids ──────────────────────────────────────────────────────────────
export const GRASS = 1;
export const GRASS_DARK = 2;
export const PATH = 3;
export const WATER = 4;
// Invisible solid blocker — collision footprint for objects + map borders.
export const SOLID = 99;
// Flat ground decor (rendered just above ground, walkable).
export const FLOWER_A = 10;
export const FLOWER_B = 11;
export const FLOWER_C = 12;
export const FLOWER_D = 13;
export const ROCK_A = 14;
export const ROCK_B = 15;

export interface TileSrc { key: string; fx: number; fy: number }
// id → (sheet, frame col/row). SOLID is intentionally absent (renders nothing).
export const TILE_SRC: Record<number, TileSrc> = {
  [GRASS]: { key: TS.terrain, fx: 2, fy: 1 },
  [GRASS_DARK]: { key: TS.terrain, fx: 12, fy: 4 },
  [PATH]: { key: TS.terrain, fx: 10, fy: 4 },
  [WATER]: { key: TS.water, fx: 1, fy: 0 },
  [FLOWER_A]: { key: TS.flowers, fx: 0, fy: 0 },
  [FLOWER_B]: { key: TS.flowers, fx: 1, fy: 0 },
  [FLOWER_C]: { key: TS.flowers, fx: 2, fy: 0 },
  [FLOWER_D]: { key: TS.flowers, fx: 3, fy: 0 },
  [ROCK_A]: { key: TS.grounddecor, fx: 0, fy: 1 },
  [ROCK_B]: { key: TS.grounddecor, fx: 1, fy: 1 },
};

export const WALKABLE_GROUND: ReadonlySet<number> = new Set([GRASS, GRASS_DARK, PATH]);
export const SOLID_DECO: ReadonlySet<number> = new Set([SOLID]);
export const FLAT_DECO: ReadonlySet<number> = new Set([
  FLOWER_A, FLOWER_B, FLOWER_C, FLOWER_D, ROCK_A, ROCK_B,
]);
export const FLOWER_IDS = [FLOWER_A, FLOWER_B, FLOWER_C, FLOWER_D];
export const ROCK_IDS = [ROCK_A, ROCK_B];

// ── Objects ─────────────────────────────────────────────────────────────
// Trees: 4 variants, each 2 tiles wide × 3 tall (32×48) in BASIC_propsNature.
export const TREE_VARIANTS = 4;
export const TREE_W = 2;
export const TREE_H = 3;
export function treeObject(variant: number, cx: number, cy: number): MapObject {
  const v = ((variant % TREE_VARIANTS) + TREE_VARIANTS) % TREE_VARIANTS;
  return { key: TS.trees, sx: v * 32, sy: 0, w: 32, h: 48, cx, cy };
}
// The tree's solid footprint: its trunk row (bottom row of the sprite).
export function treeSolidCells(cx: number, cy: number): [number, number][] {
  return [[cx, cy + TREE_H - 1], [cx + 1, cy + TREE_H - 1]];
}

// Houses: 7 colour variants, each 6×6 tiles (96×96) in CozyTowns Houses.png.
export const HOUSE_VARIANTS = 7;
export const HOUSE_W = 6;
export const HOUSE_H = 6;
export function houseObject(variant: number, cx: number, cy: number): MapObject {
  const v = ((variant % HOUSE_VARIANTS) + HOUSE_VARIANTS) % HOUSE_VARIANTS;
  return { key: TS.houses, sx: v * 96, sy: 0, w: 96, h: 96, cx, cy };
}
// Door cells (the visible doorway, bottom-centre) — walkable, trigger entry.
export function houseDoorCells(cx: number, cy: number): [number, number][] {
  return [[cx + 2, cy + HOUSE_H - 1], [cx + 3, cy + HOUSE_H - 1]];
}
// Solid cells for a house: the whole 6×6 footprint minus the door cells.
export function houseSolidCells(cx: number, cy: number): [number, number][] {
  const doors = new Set(houseDoorCells(cx, cy).map(([c, r]) => `${c},${r}`));
  const cells: [number, number][] = [];
  for (let r = 0; r < HOUSE_H; r++) {
    for (let c = 0; c < HOUSE_W; c++) {
      const cc = cx + c;
      const rr = cy + r;
      if (!doors.has(`${cc},${rr}`)) cells.push([cc, rr]);
    }
  }
  return cells;
}
