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
  cow: "cv-cow",
  chicken: "cv-chicken",
  beach: "cv-beach",
} as const;

const PV = "assets/CozyValley_Premium_1.3/CozyValley_Premium_1.3";
const P = `${PV}/Tilesets`;
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
  { key: TS.cow, path: `${PV}/Animals/Cow/Cow_brownwhite.png` },
  { key: TS.chicken, path: `${PV}/Animals/Chicken/Chicken_brown.png` },
  { key: TS.beach, path: `${P}/Beach.png` },
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

// ── Farm animals (animated) ───────────────────────────────────────────────
// Cows: 32×32 (2×2 tile) frames in Cow_brownwhite.png (4 cols × 5 rows). Each
// row is an animation clip (frames laid out left→right): row 0 = standing idle,
// row 2 = grazing, row 4 = lying/resting.
const f32 = (col: number, row: number) => ({ sx: col * 32, sy: row * 32 });
export const COW_ANIMS = {
  idle: { frames: [f32(0, 0), f32(1, 0), f32(2, 0), f32(3, 0)], fps: 3 },
  graze: { frames: [f32(0, 2), f32(1, 2)], fps: 2 },
  lie: { frames: [f32(1, 4), f32(2, 4), f32(3, 4)], fps: 1.5 },
} as const;
export type CowAnim = keyof typeof COW_ANIMS;
export function cowObject(anim: CowAnim, cx: number, cy: number): MapObject {
  const a = COW_ANIMS[anim];
  return { key: TS.cow, sx: a.frames[0].sx, sy: a.frames[0].sy, w: 32, h: 32, cx, cy, frames: [...a.frames], fps: a.fps };
}
// A cow's solid footprint: the bottom row of its 2×2 sprite (where it stands).
export function cowSolidCells(cx: number, cy: number): [number, number][] {
  return [[cx, cy + 1], [cx + 1, cy + 1]];
}

// Chicken: 16×16 frames in Chicken_brown.png (2 cols × 5 rows). Rows 0–1 give a
// little head-up / peck cycle. Decorative — no collision footprint.
const f16 = (col: number, row: number) => ({ sx: col * 16, sy: row * 16 });
const CHICKEN_PECK = { frames: [f16(0, 0), f16(1, 0), f16(0, 1), f16(1, 1)], fps: 3 };
export function chickenObject(cx: number, cy: number): MapObject {
  return { key: TS.chicken, sx: 0, sy: 0, w: 16, h: 16, cx, cy, frames: [...CHICKEN_PECK.frames], fps: CHICKEN_PECK.fps };
}

// ── Sandy dirt (paths + shore) ────────────────────────────────────────────
// Paths and the shore use the Beach sand sheet, which is sand-over-grass: a
// solid sand centre plus a fringe of mostly-transparent "tuft" tiles that spill
// organically onto the surrounding grass. So a dirt cell is drawn as solid sand
// on top of grass, and each grass cell touching sand gets a tuft overlay on the
// sand-facing side — giving the irregular, hand-drawn edges (no straight lines).
export const SAND_CENTER = { sx: 2 * 16, sy: 2 * 16 }; // solid sand fill
// Sand cells touching water (the shore) use the Beach 3×3's organic rounded
// edges/corners on the water-facing side, so the coastline + island corners
// are hand-drawn curves rather than hard rectangles. bits: N=1,E=2,S=4,W=8.
export function sandFrame(waterBits: number): { sx: number; sy: number } {
  const N = waterBits & 1, E = waterBits & 2, S = waterBits & 4, W = waterBits & 8;
  let col = 2, row = 2; // solid centre (inland path)
  if (N && W) { col = 1; row = 1; }
  else if (N && E) { col = 3; row = 1; }
  else if (S && W) { col = 1; row = 3; }
  else if (S && E) { col = 3; row = 3; }
  else if (N) { col = 2; row = 1; }
  else if (S) { col = 2; row = 3; }
  else if (W) { col = 1; row = 2; }
  else if (E) { col = 3; row = 2; }
  return { sx: col * 16, sy: row * 16 };
}
// Tuft overlays for a GRASS cell, keyed by which side the sand is on. Three
// variants each, picked by position for a bit of variety.
export const SAND_FRINGE: Record<"N" | "E" | "S" | "W", { sx: number; sy: number }[]> = {
  // sand is to the South → tufts hang from this cell's bottom edge (sheet row 0)
  S: [{ sx: 16, sy: 0 }, { sx: 32, sy: 0 }, { sx: 48, sy: 0 }],
  // sand to the North → tufts on top edge (row 4)
  N: [{ sx: 16, sy: 64 }, { sx: 32, sy: 64 }, { sx: 48, sy: 64 }],
  // sand to the East → tufts on right edge (col 0)
  E: [{ sx: 0, sy: 16 }, { sx: 0, sy: 32 }, { sx: 0, sy: 48 }],
  // sand to the West → tufts on left edge (col 4)
  W: [{ sx: 64, sy: 16 }, { sx: 64, sy: 32 }, { sx: 64, sy: 48 }],
};

// ── Grass-patch decals ────────────────────────────────────────────────────
// Organic light/dark grass blobs (Terrain.png cols 11–13) stamped as flat
// overlays to break up the plain grass fill. Each is a 3×3 (48×48) soft blob.
export function grassPatchObject(kind: "light" | "dark", cx: number, cy: number): MapObject {
  return { key: TS.terrain, sx: 11 * 16, sy: (kind === "light" ? 0 : 3) * 16, w: 48, h: 48, cx, cy, flat: true };
}

// ── Wooden fence ──────────────────────────────────────────────────────────
// The first 3×3 block of Woodenfence.png is a pen template: four corners and
// the straight rails between them. Each piece is one 16×16 tile.
export const FENCE = {
  TL: { sx: 0, sy: 0 },
  TOP: { sx: 16, sy: 0 },
  TR: { sx: 32, sy: 0 },
  LEFT: { sx: 0, sy: 16 },
  RIGHT: { sx: 32, sy: 16 },
  BL: { sx: 0, sy: 32 },
  BOTTOM: { sx: 16, sy: 32 },
  BR: { sx: 32, sy: 32 },
} as const;
export function fenceObject(part: { sx: number; sy: number }, cx: number, cy: number): MapObject {
  return { key: TS.fence, sx: part.sx, sy: part.sy, w: 16, h: 16, cx, cy };
}
