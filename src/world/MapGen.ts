import type { MapDef } from "../types/map";

// Mulberry32 — fast, good-quality seeded PRNG
function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6D2B79F5;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

function ri(rng: () => number, n: number): number {
  return Math.floor(rng() * n);
}

const COLS = 30;
const ROWS = 20;

const WALKABLE_GROUND: ReadonlySet<number> = new Set([0, 1]);

const SOLID_DECO: ReadonlySet<number> = new Set([
  // Small ground clutter — flat, but blocks movement
  3, 4, 15, 16, 27, 28,
  // Lamp posts / signs
  7, 18, 19, 20, 31,
  // Building walls
  33, 34, 35, 36, 37, 38, 39, 40, 41, 42,
  44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56,
  // Building facade
  60, 61, 62, 63, 64, 65, 66, 67, 68,
  72, 73, 75, 76, 79, 80, 82, 84, 86, 87, 88, 89, 94,
  // Houses (3×3 sprite)
  96, 97, 98, 108, 109, 110, 120, 121, 122,
]);

const FLAT_DECO: ReadonlySet<number> = new Set([
  3, 4, 15, 16, 27, 28, // small stones / grass tufts
  43,                   // stone path
]);

export function generateMap(seed: number): MapDef {
  const rng = seededRng(seed);

  const ground: number[][] = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
  const deco: number[][] = Array.from({ length: ROWS }, () => new Array(COLS).fill(-1));

  // ── Roads ───────────────────────────────────────────────────────
  // Main horizontal road, full width
  const hRoad = 5 + ri(rng, 9);          // row 5-13
  for (let c = 0; c < COLS; c++) ground[hRoad][c] = 1;

  // Main vertical road, full height
  const vRoad = 7 + ri(rng, 15);         // col 7-21
  for (let r = 0; r < ROWS; r++) ground[r][vRoad] = 1;

  // Optional branch road (70% chance), either above or below main road
  if (rng() < 0.7) {
    const offset = (hRoad > 10) ? -(3 + ri(rng, 4)) : (3 + ri(rng, 4));
    const branchRow = Phaser_clamp(hRoad + offset, 1, ROWS - 2);
    const start = ri(rng, 8);
    const len = 10 + ri(rng, 10);
    for (let c = start; c < Math.min(start + len, COLS); c++) {
      ground[branchRow][c] = 1;
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────
  // True if every cell in radius `buf` around (c, r) is empty grass
  const isClear = (c: number, r: number, buf = 1): boolean => {
    for (let dc = -buf; dc <= buf; dc++) {
      for (let dr = -buf; dr <= buf; dr++) {
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) return false;
        if (ground[nr][nc] !== 0) return false;
        if (deco[nr][nc] !== -1) return false;
      }
    }
    return true;
  };

  // ── Trees ────────────────────────────────────────────────────────
  const numTrees = 8 + ri(rng, 10);
  let treesPlaced = 0;
  for (let attempt = 0; attempt < numTrees * 8; attempt++) {
    if (treesPlaced >= numTrees) break;
    const tc = 1 + ri(rng, COLS - 2);
    const tr = 1 + ri(rng, ROWS - 3);
    if (isClear(tc, tr) && isClear(tc, tr + 1)) {
      deco[tr][tc] = 4;       // tree top
      deco[tr + 1][tc] = 16;  // tree trunk
      treesPlaced++;
    }
  }

  // ── Houses ───────────────────────────────────────────────────────
  const numHouses = 2 + ri(rng, 3);
  let housesPlaced = 0;
  for (let attempt = 0; attempt < numHouses * 30; attempt++) {
    if (housesPlaced >= numHouses) break;
    const hc = 1 + ri(rng, COLS - 5);
    const hr = 1 + ri(rng, ROWS - 5);

    // Needs a clean 3×3 footprint plus 1-tile border (5×5 total)
    let ok = true;
    outer: for (let dc = -1; dc <= 3; dc++) {
      for (let dr = -1; dr <= 3; dr++) {
        const nc = hc + dc, nr = hr + dr;
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) { ok = false; break outer; }
        if (ground[nr][nc] !== 0 || deco[nr][nc] !== -1) { ok = false; break outer; }
      }
    }
    if (!ok) continue;

    deco[hr    ][hc] = 96;  deco[hr    ][hc + 1] = 97;  deco[hr    ][hc + 2] = 98;
    deco[hr + 1][hc] = 108; deco[hr + 1][hc + 1] = 109; deco[hr + 1][hc + 2] = 110;
    deco[hr + 2][hc] = 120; deco[hr + 2][hc + 1] = 121; deco[hr + 2][hc + 2] = 122;
    housesPlaced++;
  }

  // ── Spawn point ──────────────────────────────────────────────────
  // Road intersection — always on a path tile
  const spawnCx = vRoad;
  const spawnCy = hRoad;

  return {
    key: `world_${seed}`,
    cols: COLS,
    rows: ROWS,
    tilesetKey: "tiles-town",
    tilesetCols: 12,
    groundLayer: ground,
    decoLayer: deco,
    walkableGround: WALKABLE_GROUND,
    solidDeco: SOLID_DECO,
    flatDeco: FLAT_DECO,
    spawnPoint: { cx: spawnCx, cy: spawnCy },
  };
}

// Inline clamp so this module stays dependency-free (usable from server too)
function Phaser_clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}
