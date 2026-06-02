import type { MapObject } from "../types/map";

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
  fish: "cv-fish",
  ifloor: "cv-ifloor",
  iwall: "cv-iwall",
  iprops: "cv-iprops",
} as const;

const PV = "assets/CozyValley_Premium_1.3/CozyValley_Premium_1.3";
const P = `${PV}/Tilesets`;
const B = "assets/CozyValley_Basic_1.0/CozyValley_Basic_1.0/Tilesets";
const HOUSING = "assets/CozyTowns_v1/Housing";
const EX = `${HOUSING}/Exterior`;

export interface SheetSpec {
  key: string;
  path: string;
}
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
  { key: TS.fish, path: `${PV}/Animals/Fish/Fish_big.png` },
  { key: TS.ifloor, path: `${HOUSING}/Interior/Floors_white.png` },
  { key: TS.iwall, path: `${HOUSING}/Interior/Walls_white.png` },
  { key: TS.iprops, path: `${HOUSING}/Props/Base/BaseProps_white.png` },
];

export const GRASS = 1;
export const GRASS_DARK = 2;
export const PATH = 3;
export const WATER = 4;

export const SOLID = 99;

export const FLOWER_A = 10;
export const FLOWER_B = 11;
export const FLOWER_C = 12;
export const FLOWER_D = 13;
export const ROCK_A = 14;
export const ROCK_B = 15;

// Interior tiles (used only by InteriorScene).
export const IFLOOR = 50;
export const IWALL = 51;

export interface TileSrc {
  key: string;
  fx: number;
  fy: number;
}

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
  [IFLOOR]: { key: TS.ifloor, fx: 2, fy: 0 },
  [IWALL]: { key: TS.iwall, fx: 0, fy: 0 },
};

export const WALKABLE_GROUND: ReadonlySet<number> = new Set([
  GRASS,
  GRASS_DARK,
  PATH,
]);
export const SOLID_DECO: ReadonlySet<number> = new Set([SOLID]);
export const FLAT_DECO: ReadonlySet<number> = new Set([
  FLOWER_A,
  FLOWER_B,
  FLOWER_C,
  FLOWER_D,
  ROCK_A,
  ROCK_B,
]);
export const FLOWER_IDS = [FLOWER_A, FLOWER_B, FLOWER_C, FLOWER_D];
export const ROCK_IDS = [ROCK_A, ROCK_B];

export const TREE_VARIANTS = 4;
export const TREE_W = 2;
export const TREE_H = 3;
export function treeObject(variant: number, cx: number, cy: number): MapObject {
  const v = ((variant % TREE_VARIANTS) + TREE_VARIANTS) % TREE_VARIANTS;
  return { key: TS.trees, sx: v * 32, sy: 0, w: 32, h: 48, cx, cy };
}

export function treeSolidCells(cx: number, cy: number): [number, number][] {
  return [
    [cx, cy + TREE_H - 1],
    [cx + 1, cy + TREE_H - 1],
  ];
}

export const HOUSE_VARIANTS = 7;
export const HOUSE_W = 6;
export const HOUSE_H = 6;
export function houseObject(
  variant: number,
  cx: number,
  cy: number,
): MapObject {
  const v = ((variant % HOUSE_VARIANTS) + HOUSE_VARIANTS) % HOUSE_VARIANTS;
  return { key: TS.houses, sx: v * 96, sy: 0, w: 96, h: 96, cx, cy };
}

export function houseDoorCells(cx: number, cy: number): [number, number][] {
  return [
    [cx + 2, cy + HOUSE_H - 1],
    [cx + 3, cy + HOUSE_H - 1],
  ];
}

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

const f32 = (col: number, row: number) => ({ sx: col * 32, sy: row * 32 });
// Cow sheet (32×32): row 0 = walk cycle (legs move), row 2 = graze (head down),
// row 3 = idle (legs planted, head/tail bob), row 4 = lie down.
export const COW_WALK = { frames: [f32(0, 0), f32(1, 0), f32(2, 0), f32(3, 0)] };
export const COW_ANIMS = {
  idle: { frames: [f32(0, 3), f32(1, 3), f32(2, 3), f32(3, 3)], fps: 3 },
  graze: { frames: [f32(0, 2), f32(1, 2)], fps: 2 },
  lie: { frames: [f32(1, 4), f32(2, 4), f32(3, 4)], fps: 1.5 },
} as const;
export type CowAnim = keyof typeof COW_ANIMS;
export function cowObject(anim: CowAnim, cx: number, cy: number): MapObject {
  const a = COW_ANIMS[anim];
  return {
    key: TS.cow,
    sx: a.frames[0].sx,
    sy: a.frames[0].sy,
    w: 32,
    h: 32,
    cx,
    cy,
    frames: [...a.frames],
    fps: a.fps,
  };
}

export function cowSolidCells(cx: number, cy: number): [number, number][] {
  return [
    [cx, cy + 1],
    [cx + 1, cy + 1],
  ];
}

const f16 = (col: number, row: number) => ({ sx: col * 16, sy: row * 16 });
// Row 2 is the head-down pecking pose — the chicken's idle "eating" loop.
const CHICKEN_PECK = {
  frames: [f16(0, 2), f16(1, 2)],
  fps: 3,
};
export function chickenObject(cx: number, cy: number): MapObject {
  return {
    key: TS.chicken,
    sx: 0,
    sy: 0,
    w: 16,
    h: 16,
    cx,
    cy,
    frames: [...CHICKEN_PECK.frames],
    fps: CHICKEN_PECK.fps,
  };
}

export const SAND_CENTER = { sx: 2 * 16, sy: 2 * 16 };

export function sandFrame(waterBits: number): { sx: number; sy: number } {
  const N = waterBits & 1,
    E = waterBits & 2,
    S = waterBits & 4,
    W = waterBits & 8;
  let col = 2,
    row = 2;
  if (N && W) {
    col = 1;
    row = 1;
  } else if (N && E) {
    col = 3;
    row = 1;
  } else if (S && W) {
    col = 1;
    row = 3;
  } else if (S && E) {
    col = 3;
    row = 3;
  } else if (N) {
    col = 2;
    row = 1;
  } else if (S) {
    col = 2;
    row = 3;
  } else if (W) {
    col = 1;
    row = 2;
  } else if (E) {
    col = 3;
    row = 2;
  }
  return { sx: col * 16, sy: row * 16 };
}

export const SAND_FRINGE: Record<
  "N" | "E" | "S" | "W",
  { sx: number; sy: number }[]
> = {
  S: [
    { sx: 16, sy: 0 },
    { sx: 32, sy: 0 },
    { sx: 48, sy: 0 },
  ],

  N: [
    { sx: 16, sy: 64 },
    { sx: 32, sy: 64 },
    { sx: 48, sy: 64 },
  ],

  E: [
    { sx: 0, sy: 16 },
    { sx: 0, sy: 32 },
    { sx: 0, sy: 48 },
  ],

  W: [
    { sx: 64, sy: 16 },
    { sx: 64, sy: 32 },
    { sx: 64, sy: 48 },
  ],
};

export function grassPatchObject(
  kind: "light" | "dark",
  cx: number,
  cy: number,
): MapObject {
  return {
    key: TS.terrain,
    sx: 11 * 16,
    sy: (kind === "light" ? 0 : 3) * 16,
    w: 48,
    h: 48,
    cx,
    cy,
    flat: true,
  };
}

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
export function fenceObject(
  part: { sx: number; sy: number },
  cx: number,
  cy: number,
): MapObject {
  return { key: TS.fence, sx: part.sx, sy: part.sy, w: 16, h: 16, cx, cy };
}

// Furniture frames inside BaseProps_white.png (measured pixel rects).
export interface InteriorProp {
  sx: number;
  sy: number;
  w: number;
  h: number;
}
export const IPROPS = {
  bookshelf: { sx: 2, sy: 0, w: 27, h: 32 },
  wardrobe: { sx: 32, sy: 0, w: 28, h: 48 },
  bedDouble: { sx: 130, sy: 99, w: 42, h: 39 },
  bedSingle: { sx: 180, sy: 99, w: 24, h: 37 },
  rug: { sx: 33, sy: 65, w: 46, h: 30 },
  sofa: { sx: 176, sy: 45, w: 31, h: 20 },
  lamp: { sx: 114, sy: 115, w: 13, h: 29 },
  window: { sx: 180, sy: 2, w: 23, h: 21 },
  picture: { sx: 148, sy: 2, w: 23, h: 22 },
  table: { sx: 50, sy: 35, w: 28, h: 29 },
} as const;

export function interiorPropObject(
  p: InteriorProp,
  cx: number,
  cy: number,
  flat = false,
): MapObject {
  return { key: TS.iprops, sx: p.sx, sy: p.sy, w: p.w, h: p.h, cx, cy, flat };
}

// Fish_big.png is a 3×2 grid of distinct 32×16 fish, not an animation strip.
// The right-facing grey shark lives at (sx 64, sy 0); use it as a single static
// sprite and let Shark's bob + move tweens sell the swimming motion.
export function sharkObject(cx: number, cy: number): MapObject {
  return {
    key: TS.fish,
    sx: 64,
    sy: 0,
    w: 32,
    h: 16,
    cx,
    cy,
  };
}
