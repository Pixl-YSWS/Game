/**
 * Syncs the hand-authored Tiled village maps into the game.
 *
 *   maps/home_town.json  → HOME_TOWN
 *   maps/main_hub.json   → MAIN_HUB
 *
 * Both are exported as `MapDef`s into src/data/villageMaps.ts. Each map keeps:
 *   - a `baked` render block: the original multi-tileset GID layers, stamped
 *     verbatim so what you draw in Tiled is what renders;
 *   - logical `groundLayer` / `decoLayer` + collision sets that the movement
 *     and animal-wander logic still run on (GRASS / PATH / WATER / SOLID);
 *   - `objects`: cows / chickens (→ animated, wandering Animal entities) and
 *     trees (static deco with a solid trunk);
 *   - `npcs`: villager markers drawn with pre-assembled character tiles.
 *
 * Tilesets are classified by their image filename, so animals/water/trees/npcs
 * become *behaviour* instead of flat tiles. Everything else renders as-is.
 *
 * Usage:  bun run sync-maps
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import type { MapObject, NpcDef, BakedTileset } from "../src/types/map.ts";
import { cowObject, chickenObject, TS } from "../src/world/tileset.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAPS_DIR = join(ROOT, "maps");
const OUT_PATH = join(ROOT, "src/data/villageMaps.ts");

// ── Logical tile ids (must match src/world/tileset.ts) ──────────────────────
const GRASS = 1;
const PATH = 3;
const WATER = 4;
const SOLID = 99;

// ── Tiled types ─────────────────────────────────────────────────────────────
interface TiledLayer {
  type: string;
  name: string;
  data?: number[];
  width: number;
  height: number;
}
interface TiledMap {
  width: number;
  height: number;
  tilesets: Array<{ firstgid: number; source: string }>;
  layers: TiledLayer[];
}

type Role = "water" | "cow" | "chicken" | "tree" | "npc" | "static";

interface Tileset {
  firstgid: number;
  columns: number;
  count: number;
  name: string; // Tiled tileset name, e.g. "oda" — used to identify NPC roles
  image: string; // phaser load path, e.g. assets/cozy-towns/.../Terrain.png
  texKey: string; // phaser texture key
  role: Role;
}

// NPC marker tilesets are named after the villager they place. Drawing an NPC
// with the "oda" tileset (a pre-assembled character sheet) spawns the merchant;
// "pip" spawns the project board curator. Anything else is a generic villager.
const NPC_TEMPLATES: Record<
  string,
  { name: string; dialogue: string[]; shopId?: string; panel?: "projects" }
> = {
  oda: { name: "Oda", dialogue: ["(Oda opens her shop.)"], shopId: "village_shop" },
  pip: {
    name: "Pip",
    dialogue: ["(Pip opens the project board.)"],
    panel: "projects",
  },
};

// Texture key + role for a tileset, derived from its source image filename.
function classify(image: string): { texKey: string; role: Role } {
  const base = basename(image).replace(/\.png$/i, "");
  if (/water/i.test(base)) return { texKey: TS.water, role: "water" };
  if (/^Cow/i.test(base)) return { texKey: TS.cow, role: "cow" };
  if (/^Chicken/i.test(base)) return { texKey: TS.chicken, role: "chicken" };
  if (/^Trees?_/i.test(base)) return { texKey: "vt-tree-oak", role: "tree" };
  // The pre-assembled character sheets sit in "-- Pre-assembled Characters".
  if (/Pre-assembled Characters/i.test(image) || /^char\d/i.test(base))
    return { texKey: `vt-npc-${base}`, role: "npc" };
  return { texKey: `vt-${base.toLowerCase()}`, role: "static" };
}

function readTsx(source: string): {
  columns: number;
  count: number;
  name: string;
  image: string;
} {
  const xml = readFileSync(join(MAPS_DIR, source), "utf8");
  const columns = Number(/columns="(\d+)"/.exec(xml)?.[1] ?? 0);
  const count = Number(/tilecount="(\d+)"/.exec(xml)?.[1] ?? 0);
  const name = /<tileset[^>]*\bname="([^"]+)"/.exec(xml)?.[1] ?? "";
  const rawImg = /<image source="([^"]+)"/.exec(xml)?.[1] ?? "";
  // .tsx image paths are like "../public/assets/..."; Phaser loads relative to
  // public/, so drop the leading "../public/".
  const image = rawImg.replace(/^(\.\.\/)*public\//, "");
  return { columns, count, name, image };
}

function tilesetFor(gid: number, sets: Tileset[]): Tileset | undefined {
  let best: Tileset | undefined;
  for (const t of sets)
    if (gid >= t.firstgid && gid < t.firstgid + t.count)
      if (!best || t.firstgid > best.firstgid) best = t;
  return best;
}

// A layer's render intent, from its (lowercased) Tiled layer name.
function layerKind(name: string): {
  perRow: boolean;
  depth: number;
  ground?: number;
  solid?: boolean;
  animateWater?: boolean;
} {
  const n = name.toLowerCase();
  if (n.includes("water")) return { perRow: false, depth: 0, ground: WATER, animateWater: true };
  if (n.includes("path")) return { perRow: false, depth: 0.1, ground: PATH };
  if (n.includes("bridge")) return { perRow: false, depth: 0.2, ground: PATH };
  if (n.includes("ground") || n.includes("tile layer"))
    return { perRow: false, depth: 0.05, ground: GRASS };
  if (n.includes("house") || n.includes("building") || n.includes("fence"))
    return { perRow: true, depth: 1, solid: true };
  // trees / animals layers are extracted to objects; anything left renders flat.
  return { perRow: true, depth: 1 };
}

// ── Connected-component grouping for multi-tile sprites ─────────────────────
interface Cell { cx: number; cy: number; gid: number; }
function components(cells: Cell[]): Cell[][] {
  const byKey = new Map<string, Cell>();
  for (const c of cells) byKey.set(`${c.cx},${c.cy}`, c);
  const seen = new Set<string>();
  const out: Cell[][] = [];
  for (const c of cells) {
    const k0 = `${c.cx},${c.cy}`;
    if (seen.has(k0)) continue;
    const group: Cell[] = [];
    const stack = [c];
    seen.add(k0);
    while (stack.length) {
      const cur = stack.pop()!;
      group.push(cur);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nk = `${cur.cx + dx},${cur.cy + dy}`;
        const nb = byKey.get(nk);
        if (nb && !seen.has(nk)) { seen.add(nk); stack.push(nb); }
      }
    }
    out.push(group);
  }
  return out;
}

function bbox(group: Cell[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of group) {
    minX = Math.min(minX, c.cx); minY = Math.min(minY, c.cy);
    maxX = Math.max(maxX, c.cx); maxY = Math.max(maxY, c.cy);
  }
  return { minX, minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// ── Per-map conversion ──────────────────────────────────────────────────────
interface BakedLayerOut { name: string; data: number[]; perRow: boolean; depth: number; animateWater?: boolean; }
interface MapResult {
  key: string;
  cols: number;
  rows: number;
  ground: number[][];
  deco: number[][];
  bakedTilesets: BakedTileset[];
  bakedLayers: BakedLayerOut[];
  objects: MapObject[];
  npcs: NpcDef[];
  spawn: { cx: number; cy: number };
  manifest: Map<string, string>; // texKey → image path (static + water + tree)
}

function convert(key: string, file: string): MapResult {
  const map: TiledMap = JSON.parse(readFileSync(join(MAPS_DIR, file), "utf8"));
  const { width: cols, height: rows } = map;

  const sets: Tileset[] = map.tilesets.map((t) => {
    const { columns, count, name, image } = readTsx(t.source);
    const { texKey, role } = classify(image);
    return { firstgid: t.firstgid, columns, count, name, image, texKey, role };
  });

  const ground: number[][] = Array.from({ length: rows }, () => Array(cols).fill(WATER));
  const deco: number[][] = Array.from({ length: rows }, () => Array(cols).fill(-1));

  const bakedLayers: BakedLayerOut[] = [];
  const usedSets = new Set<Tileset>();
  const cows: Cell[] = [];
  const chickens: Cell[] = [];
  const npcCells: Cell[] = [];

  for (const layer of map.layers) {
    if (layer.type !== "tilelayer" || !layer.data) continue;
    const kind = layerKind(layer.name);
    const baked = new Array(cols * rows).fill(0);
    let hasBaked = false;

    for (let i = 0; i < layer.data.length; i++) {
      const gid = layer.data[i];
      if (!gid) continue;
      const cx = i % cols;
      const cy = (i / cols) | 0;
      const ts = tilesetFor(gid, sets);
      if (!ts) continue;

      // Drop each map's own inter-map connector bridge — the custom bridge
      // replaces it.
      if (ts.texKey === DOCKS_KEY && REMOVE_BRIDGE[file]?.(cx, cy)) continue;

      switch (ts.role) {
        case "cow": cows.push({ cx, cy, gid }); break;
        case "chicken": chickens.push({ cx, cy, gid }); break;
        case "npc": npcCells.push({ cx, cy, gid }); break;
        // Trees fall through to `default`: they bake as normal per-tile deco so
        // dense forests render + depth-sort per tile (no flood-merge, no phantom
        // solid base rows that would block the grass behind them).
        default: {
          // Static or water tile → bake it and record logical terrain.
          baked[i] = gid;
          hasBaked = true;
          usedSets.add(ts);
          if (kind.ground !== undefined) {
            // path/bridge override grass; water only fills where nothing else has.
            const cur = ground[cy][cx];
            if (kind.ground === PATH || (kind.ground === GRASS && cur !== PATH))
              ground[cy][cx] = kind.ground;
            else if (kind.ground === WATER && cur === WATER) ground[cy][cx] = WATER;
          }
          if (kind.solid) deco[cy][cx] = SOLID;
        }
      }
    }

    if (hasBaked)
      bakedLayers.push({
        name: layer.name,
        data: baked,
        perRow: kind.perRow,
        depth: kind.depth,
        ...(kind.animateWater ? { animateWater: true } : {}),
      });
  }

  // Cells with a baked terrain tile become grass if still flagged water.
  // (already handled per-cell above)

  const objects: MapObject[] = [];

  // Cows: 2×2 sprite blocks → one wandering Animal each.
  for (const g of components(cows)) {
    const b = bbox(g);
    objects.push(cowObject("idle", b.minX, b.minY));
  }
  // Chickens: single tiles → one Animal each.
  for (const g of components(chickens)) {
    const b = bbox(g);
    objects.push(chickenObject(b.minX, b.minY));
  }

  // NPCs: pre-assembled character tiles (2×2) → a villager marker. The tileset
  // name (e.g. "oda") selects the villager's role; its char sheet sets the look.
  const npcs: NpcDef[] = [];
  components(npcCells).forEach((g, idx) => {
    const b = bbox(g);
    const ts = tilesetFor(g[0].gid, sets);
    const tsName = (ts?.name ?? "").toLowerCase();
    // The image is char<N>.png → recover N as the NPC's character sprite.
    const spriteNum = Number(/char(\d+)/i.exec(ts?.image ?? "")?.[1] ?? 1);
    const tpl = NPC_TEMPLATES[tsName];
    npcs.push({
      id: `${key.toLowerCase()}-${tpl ? tsName : `villager-${idx + 1}`}`,
      cx: b.minX,
      cy: b.minY,
      name: tpl?.name ?? "Villager",
      sprite: spriteNum,
      dialogue: tpl?.dialogue ?? ["Welcome to the village!"],
      ...(tpl?.shopId ? { shopId: tpl.shopId } : {}),
      ...(tpl?.panel ? { panel: tpl.panel } : {}),
    });
  });

  // Spawn: prefer a walkable path cell near the map centre.
  const spawn = pickSpawn(ground, deco, cols, rows);

  // Manifest: every baked tileset image (trees now bake like any other tile).
  const manifest = new Map<string, string>();
  for (const ts of usedSets) manifest.set(ts.texKey, ts.image);

  const bakedTilesets: BakedTileset[] = [...usedSets].map((ts) => ({
    key: ts.texKey,
    firstgid: ts.firstgid,
    columns: ts.columns,
    count: ts.count,
  }));

  return {
    key, cols, rows, ground, deco,
    bakedTilesets, bakedLayers, objects, npcs, spawn, manifest,
  };
}

function pickSpawn(ground: number[][], deco: number[][], cols: number, rows: number) {
  const cx0 = (cols / 2) | 0;
  const cy0 = (rows / 2) | 0;
  let best: { cx: number; cy: number } | null = null;
  let bestD = Infinity;
  for (let cy = 0; cy < rows; cy++)
    for (let cx = 0; cx < cols; cx++) {
      if (ground[cy][cx] !== PATH || deco[cy][cx] === SOLID) continue;
      const d = (cx - cx0) ** 2 + (cy - cy0) ** 2;
      if (d < bestD) { bestD = d; best = { cx, cy }; }
    }
  return best ?? { cx: cx0, cy: cy0 };
}

// ── Serialisation ───────────────────────────────────────────────────────────
function fmtGrid(grid: number[][]): string {
  return `[\n${grid.map((r) => `    [${r.join(",")}]`).join(",\n")},\n  ]`;
}
function fmtFlat(arr: number[]): string {
  return `[${arr.join(",")}]`;
}
function obj(o: unknown): string {
  return JSON.stringify(o);
}

function emitMap(r: MapResult): string {
  const layers = r.bakedLayers
    .map(
      (l) =>
        `      { name: ${obj(l.name)}, perRow: ${l.perRow}, depth: ${l.depth}` +
        `${l.animateWater ? ", animateWater: true" : ""}, data: ${fmtFlat(l.data)} }`,
    )
    .join(",\n");

  return `export const ${r.key}: MapDef = {
  key: ${obj(r.key.toLowerCase())},
  cols: ${r.cols},
  rows: ${r.rows},
  tilesetKey: "vt",
  tilesetCols: 1,
  groundLayer: ${fmtGrid(r.ground)},
  decoLayer: ${fmtGrid(r.deco)},
  baked: {
    tileSize: 16,
    tilesets: ${obj(r.bakedTilesets)},
    layers: [
${layers}
    ],
  },
  objects: ${obj(r.objects)},
  walkableGround: new Set([${GRASS}, 2, ${PATH}]),
  solidDeco: new Set([${SOLID}]),
  flatDeco: new Set([]),
  spawnPoint: ${obj(r.spawn)},
  doors: [],
  npcs: ${obj(r.npcs)},
};`;
}

// ── Stitch ──────────────────────────────────────────────────────────────────
// The two maps join into one walkable map. main_hub sits at the origin;
// home_town is placed to its east so home_town's west-edge bridge (0,8)/(0,9)
// lands right beside main_hub's bottom-island path tip (col 24, rows 29–32).
// Tweak HOME_TOWN_OFFSET if you redraw the maps.
interface Placement {
  res: MapResult;
  ox: number;
  oy: number;
}

// home_town is placed fully east of main_hub (no overlap) so main_hub's own
// east water reads as a channel between the two islands. offset.y aligns
// home_town's west entrance (rows 8/9) to main_hub's gateway rows (29/30).
const HOME_TOWN_OFFSET = { x: 32, y: 21 };

// Each map drew its own connector bridge stub toward the other; these are
// dropped (per map) and replaced by one custom bridge span. main_hub's internal
// vertical bridges (cols 8–12) are left intact.
const DOCKS_KEY = "vt-docksbridges";
// The Terrain sheet's brown cliff-face tiles are vertical walls — you can stand
// on the grass top, not the face. Block these local ids (Terrain = "vt-terrain").
const TERRAIN_KEY = "vt-terrain";
const CLIFF_SOLID = new Set([64, 65, 66, 67, 80, 81, 82, 83, 84, 85, 86, 87, 88]);
const REMOVE_BRIDGE: Record<string, (cx: number, cy: number) => boolean> = {
  "home_town.json": () => true, // its only bridge is the west connector stub
  "main_hub.json": (cx, cy) => cy >= 30 && cy <= 31 && cx >= 24, // east stub
};

// A custom connector bridge across the channel, built from the SAME bridge
// texture the maps use (DocksBridges). It's a proper east-west bridge: a rope
// rail row (a collider) above and below a 2-row walkable plank deck, so you
// can't walk off the sides into the water. Spans main_hub's gateway tip (col 24)
// to home_town's west land edge (col 35), at rows 29–32.
const BRIDGE_FROM_COL = 25;
const BRIDGE_TO_COL = 34;
const BRIDGE_RAIL_TOP = 29;
const BRIDGE_DECK = [30, 31];
const BRIDGE_RAIL_BOT = 32;
// Local tile ids within DocksBridges (12 cols). Each strip is left-cap / mid /
// right-cap; rope rails are the solid edges, the deck rows are walkable.
const BRIDGE_STRIPS = {
  railTop: { capL: 8, mid: 9, capR: 11 },
  deckTop: { capL: 20, mid: 21, capR: 23 },
  deckBot: { capL: 32, mid: 33, capR: 35 },
  railBot: { capL: 68, mid: 69, capR: 71 },
};

function stitch(key: string, placements: Placement[]): MapResult {
  const W = Math.max(...placements.map((p) => p.ox + p.res.cols));
  const H = Math.max(...placements.map((p) => p.oy + p.res.rows));

  // Unify the per-map tileset tables into one GID namespace.
  const combined: BakedTileset[] = [];
  const baseByKey = new Map<string, number>();
  let next = 1;
  for (const p of placements)
    for (const ts of p.res.bakedTilesets)
      if (!baseByKey.has(ts.key)) {
        baseByKey.set(ts.key, next);
        combined.push({ key: ts.key, firstgid: next, columns: ts.columns, count: ts.count });
        next += ts.count;
      }
  const remapFor = (res: MapResult) => (gid: number) => {
    for (const ts of res.bakedTilesets)
      if (gid >= ts.firstgid && gid < ts.firstgid + ts.count)
        return baseByKey.get(ts.key)! + (gid - ts.firstgid);
    return 0;
  };

  const ground: number[][] = Array.from({ length: H }, () => Array(W).fill(WATER));
  const deco: number[][] = Array.from({ length: H }, () => Array(W).fill(-1));
  const bakedLayers: BakedLayerOut[] = [];
  const objects: MapObject[] = [];
  const npcs: NpcDef[] = [];
  const manifest = new Map<string, string>();

  for (const p of placements) {
    // Logical layers (later placements win in the overlap region).
    for (let r = 0; r < p.res.rows; r++)
      for (let c = 0; c < p.res.cols; c++) {
        ground[p.oy + r][p.ox + c] = p.res.ground[r][c];
        deco[p.oy + r][p.ox + c] = p.res.deco[r][c];
      }
    // Baked render layers, GIDs remapped + offset into the combined grid.
    const remap = remapFor(p.res);
    for (const l of p.res.bakedLayers) {
      const data = new Array(W * H).fill(0);
      for (let i = 0; i < l.data.length; i++) {
        const gid = l.data[i];
        if (!gid) continue;
        const c = i % p.res.cols;
        const r = (i / p.res.cols) | 0;
        data[(p.oy + r) * W + (p.ox + c)] = remap(gid);
      }
      bakedLayers.push({ ...l, data });
    }
    for (const o of p.res.objects)
      objects.push({ ...o, cx: o.cx + p.ox, cy: o.cy + p.oy });
    for (const n of p.res.npcs)
      npcs.push({ ...n, cx: n.cx + p.ox, cy: n.cy + p.oy });
    for (const [k, v] of p.res.manifest) manifest.set(k, v);
  }

  // Custom connector bridge across the channel, built from the maps' own
  // DocksBridges texture. Deck rows are walkable; the rope rails above/below are
  // solid colliders so you stay on the bridge.
  const docks = combined.find((t) => t.key === DOCKS_KEY);
  if (docks) {
    const fg = docks.firstgid;
    const data = new Array(W * H).fill(0);
    const strip = (
      row: number,
      s: { capL: number; mid: number; capR: number },
    ) => {
      for (let c = BRIDGE_FROM_COL; c <= BRIDGE_TO_COL; c++) {
        const id = c === BRIDGE_FROM_COL ? s.capL : c === BRIDGE_TO_COL ? s.capR : s.mid;
        data[row * W + c] = fg + id;
      }
    };
    strip(BRIDGE_RAIL_TOP, BRIDGE_STRIPS.railTop);
    strip(BRIDGE_DECK[0], BRIDGE_STRIPS.deckTop);
    strip(BRIDGE_DECK[1], BRIDGE_STRIPS.deckBot);
    strip(BRIDGE_RAIL_BOT, BRIDGE_STRIPS.railBot);
    for (let c = BRIDGE_FROM_COL; c <= BRIDGE_TO_COL; c++) {
      // Deck: walkable. Rails: solid colliders.
      for (const r of BRIDGE_DECK) {
        ground[r][c] = PATH;
        deco[r][c] = -1;
      }
      deco[BRIDGE_RAIL_TOP][c] = SOLID;
      deco[BRIDGE_RAIL_BOT][c] = SOLID;
    }
    bakedLayers.push({ name: "connector-bridge", perRow: false, depth: 0.2, data });
  }

  // Spawn from the primary (first) placement.
  const prim = placements[0];
  const spawn = {
    cx: prim.res.spawn.cx + prim.ox,
    cy: prim.res.spawn.cy + prim.oy,
  };

  return {
    key, cols: W, rows: H, ground, deco,
    bakedTilesets: combined, bakedLayers, objects, npcs, spawn, manifest,
  };
}

// ── Run ─────────────────────────────────────────────────────────────────────
const mainHub = convert("MAIN_HUB", "main_hub.json");
const homeTown = convert("HOME_TOWN", "home_town.json");

const village = stitch("VILLAGE", [
  { res: mainHub, ox: 0, oy: 0 },
  { res: homeTown, ox: HOME_TOWN_OFFSET.x, oy: HOME_TOWN_OFFSET.y },
]);

const manifestEntries = [...village.manifest].map(([key, path]) => ({ key, path }));

const output = `// AUTO-GENERATED by scripts/sync-maps.ts — do not edit by hand.
// Run \`bun run sync-maps\` after editing maps/home_town.* or maps/main_hub.*.
import type { MapDef } from "../types/map";

/** Tileset images the baked village map renders from. Loaded in BootScene. */
export const VILLAGE_TILESETS: { key: string; path: string }[] = ${obj(manifestEntries)};

${emitMap(village)}
`;

writeFileSync(OUT_PATH, output);
console.log(
  `✓ Synced village maps → src/data/villageMaps.ts\n` +
    `  VILLAGE  ${village.cols}×${village.rows}  ` +
    `${village.objects.length} objects, ${village.npcs.length} npcs, ${village.bakedLayers.length} layers\n` +
    `  (main_hub @0,0 + home_town @${HOME_TOWN_OFFSET.x},${HOME_TOWN_OFFSET.y})\n` +
    `  ${manifestEntries.length} tileset textures`,
);
