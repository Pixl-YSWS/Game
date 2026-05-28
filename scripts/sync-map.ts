/**
 * Reads maps/map1.json (Tiled export) and regenerates src/data/MapData.ts.
 *
 * Convention:
 *   - First tile layer  → groundLayer
 *   - All other layers  → merged into decoLayer (later layers win per cell)
 *
 * WALKABLE_GROUND, SOLID_DECO, and spawnPoint are preserved from the
 * existing MapData.ts so you can keep tuning them without re-running the script.
 *
 * Usage:  bun run sync-map
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAP_PATH = join(ROOT, "maps/map1.json");
const OUT_PATH = join(ROOT, "src/data/MapData.ts");

// ── Parse Tiled JSON ────────────────────────────────────────────────────────

interface TiledMap {
  width: number;
  height: number;
  tilesets: Array<{ firstgid: number; source: string }>;
  layers: Array<{ type: string; name: string; data: number[]; width: number; height: number }>;
}

const tiled: TiledMap = JSON.parse(readFileSync(MAP_PATH, "utf8"));

const cols = tiled.width;
const rows = tiled.height;

// Use the tileset with the lowest firstgid as the primary tileset.
const primaryFirstGid = tiled.tilesets.reduce(
  (min, ts) => Math.min(min, ts.firstgid),
  Infinity,
);

// Tiled GID → 0-based local tile index, 0 (empty) → -1
function toLocal(gid: number): number {
  return gid === 0 ? -1 : gid - primaryFirstGid;
}

function to2D(flat: number[]): number[][] {
  const grid: number[][] = [];
  for (let r = 0; r < rows; r++) {
    grid.push(flat.slice(r * cols, (r + 1) * cols).map(toLocal));
  }
  return grid;
}

const tileLayers = tiled.layers.filter((l) => l.type === "tilelayer");
if (tileLayers.length === 0) {
  console.error("No tile layers found in map1.json");
  process.exit(1);
}

const groundLayer = to2D(tileLayers[0].data);

// Merge remaining layers: later layers override earlier ones per cell.
const decoLayer: number[][] = Array.from({ length: rows }, () =>
  Array(cols).fill(-1),
);
for (let i = 1; i < tileLayers.length; i++) {
  const layer = to2D(tileLayers[i].data);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (layer[r][c] !== -1) decoLayer[r][c] = layer[r][c];
    }
  }
}

// ── Preserve hand-tuned values from existing MapData.ts ────────────────────

let walkableStr = "0, 1, 2";
let solidStr = "";
let spawnCx = 0;
let spawnCy = 0;

try {
  const existing = readFileSync(OUT_PATH, "utf8");

  const wm = existing.match(/const WALKABLE_GROUND = new Set\(\[([\s\S]*?)\]\)/);
  if (wm) walkableStr = wm[1].trim();

  const sm = existing.match(/const SOLID_DECO = new Set\(\[([\s\S]*?)\]\)/);
  if (sm) solidStr = sm[1].trim();

  const pm = existing.match(/spawnPoint:\s*\{\s*cx:\s*(\d+),\s*cy:\s*(\d+)\s*\}/);
  if (pm) { spawnCx = parseInt(pm[1]); spawnCy = parseInt(pm[2]); }
} catch {
  console.warn("Could not read existing MapData.ts — using defaults.");
}

// ── Format helpers ──────────────────────────────────────────────────────────

function fmtLayer(grid: number[][], name: string): string {
  const rowStrs = grid.map((row) => `  [${row.join(", ")}]`).join(",\n");
  return `const ${name}: number[][] = [\n${rowStrs},\n];`;
}

// ── Write MapData.ts ────────────────────────────────────────────────────────

const output = `import type { MapDef } from "../types/map";

${fmtLayer(groundLayer, "GROUND_LAYER")}

${fmtLayer(decoLayer, "DECO_LAYER")}

const WALKABLE_GROUND = new Set([
  ${walkableStr}
]);

const SOLID_DECO = new Set([
  ${solidStr}
]);

export const TOWN_MAP: MapDef = {
  key: "town",
  cols: ${cols},
  rows: ${rows},
  tilesetKey: "tiles-town",
  tilesetCols: 12,
  groundLayer: GROUND_LAYER,
  decoLayer: DECO_LAYER,
  walkableGround: WALKABLE_GROUND,
  solidDeco: SOLID_DECO,
  spawnPoint: { cx: ${spawnCx}, cy: ${spawnCy} },
};
`;

writeFileSync(OUT_PATH, output);
console.log(
  `✓ Synced map1.json → MapData.ts  (${cols}×${rows}, ${tileLayers.length} layers merged)`,
);
