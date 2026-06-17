import type { MapDef, NpcDef } from "../types/map";
import { VILLAGE } from "../data/villageMaps";
import { sharkObject, WATER } from "./tileset";

// Friendly blahaj that patrol the channel between the islands (open-water tiles).
const BLAHAJ_SPOTS: ReadonlyArray<readonly [number, number]> = [
  [29, 25],
  [29, 40],
  [31, 44],
];

interface Cell {
  cx: number;
  cy: number;
}

function inB(m: MapDef, c: number, r: number): boolean {
  return c >= 0 && r >= 0 && c < m.cols && r < m.rows;
}
function walkable(m: MapDef, c: number, r: number): boolean {
  if (!inB(m, c, r)) return false;
  const g = m.groundLayer[r][c];
  if (!m.walkableGround.has(g)) return false;
  const d = m.decoLayer[r][c];
  return !(d >= 0 && m.solidDeco.has(d));
}

// Spiral out from an anchor for the first cell matching `ok`.
function nearestWalkable(
  m: MapDef,
  anchor: Cell,
  ok: (c: number, r: number) => boolean,
): Cell | undefined {
  const max = Math.max(m.cols, m.rows);
  for (let rad = 0; rad <= max; rad++)
    for (let dy = -rad; dy <= rad; dy++)
      for (let dx = -rad; dx <= rad; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
        const c = anchor.cx + dx;
        const r = anchor.cy + dy;
        if (ok(c, r)) return { cx: c, cy: r };
      }
  return undefined;
}

/**
 * A fresh, deep-enough copy of the village map (main_hub + home_town stitched
 * into one walkable map by the sync script). The loaded map gets mutated in
 * place (animals are pulled out of `objects`, edits paint the layers), so
 * callers must never share the module singleton. The big read-only
 * `baked.layers[].data` GID arrays are never mutated, so they're shared.
 *
 * The leave-village portal and the Pip project-board NPC are injected here
 * since they aren't drawn into the Tiled maps.
 */
export function villageMap(): MapDef {
  const m: MapDef = {
    ...VILLAGE,
    // No swimming in the village — you cross on the bridges, not the water.
    noSwim: true,
    groundLayer: VILLAGE.groundLayer.map((r) => [...r]),
    decoLayer: VILLAGE.decoLayer.map((r) => [...r]),
    objects: VILLAGE.objects?.map((o) => ({
      ...o,
      frames: o.frames?.map((f) => ({ ...f })),
    })),
    npcs: VILLAGE.npcs.map((n) => ({ ...n, dialogue: [...n.dialogue] })),
    spawnPoint: { ...VILLAGE.spawnPoint },
    doors: VILLAGE.doors.map((d) => ({ ...d })),
    baked: VILLAGE.baked && {
      ...VILLAGE.baked,
      tilesets: VILLAGE.baked.tilesets.map((t) => ({ ...t })),
      layers: VILLAGE.baked.layers.map((l) => ({ ...l })),
    },
  };

  injectExtras(m);
  trimHouseRoofs(m);
  m.bridgeTiles = computeBridgeTiles(m);

  // Blahaj — only where the spot is actually open water on the current map.
  m.objects = m.objects ?? [];
  for (const [cx, cy] of BLAHAJ_SPOTS) {
    if (m.groundLayer[cy]?.[cx] === WATER) m.objects.push(sharkObject(cx, cy));
  }

  return m;
}

// Buildings (houses/barn/tents) are drawn full-height including their roofs, but
// the baked collision marks the whole sprite solid — so players get blocked a
// couple tiles above the building and can't walk behind the roof peak. Clear
// just the top roof rows of each building's collision (so you can slip behind
// the peak) while keeping the bulk of the body solid.
const ROOF_CLEAR_ROWS = 2;
const BUILDING_TILESETS = new Set(["vt-houses", "vt-barn", "vt-tents_big"]);
const GID_MASK = 0x1fffffff;

function trimHouseRoofs(m: MapDef) {
  const baked = m.baked;
  if (!baked) return;
  const { cols, rows } = m;

  const isBuildingGid = (gid: number) => {
    const g = gid & GID_MASK;
    for (const t of baked.tilesets)
      if (g >= t.firstgid && g < t.firstgid + t.count)
        return BUILDING_TILESETS.has(t.key);
    return false;
  };

  // Cells that are a building sprite AND currently solid.
  const solid: boolean[] = new Array(cols * rows).fill(false);
  for (let i = 0; i < cols * rows; i++) {
    const c = i % cols;
    const r = (i / cols) | 0;
    if (m.decoLayer[r][c] !== 99) continue;
    if (baked.layers.some((l) => l.data[i] && isBuildingGid(l.data[i])))
      solid[i] = true;
  }

  // Flood-fill each building footprint and clear all but its bottom two rows.
  const seen = new Array(cols * rows).fill(false);
  for (let start = 0; start < cols * rows; start++) {
    if (!solid[start] || seen[start]) continue;
    const comp: number[] = [];
    const stack = [start];
    seen[start] = true;
    let minRow = rows;
    let maxRow = 0;
    while (stack.length) {
      const i = stack.pop()!;
      comp.push(i);
      const c = i % cols;
      const r = (i / cols) | 0;
      if (r > maxRow) maxRow = r;
      if (r < minRow) minRow = r;
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const ni = nr * cols + nc;
        if (solid[ni] && !seen[ni]) {
          seen[ni] = true;
          stack.push(ni);
        }
      }
    }
    // Clear the top roof rows, but always keep at least the bottom two rows solid.
    const height = maxRow - minRow + 1;
    const clearN = Math.max(0, Math.min(ROOF_CLEAR_ROWS, height - 2));
    for (const i of comp) {
      const r = (i / cols) | 0;
      if (r < minRow + clearN) m.decoLayer[r][i % cols] = -1;
    }
  }
}

// Tiles a bridge is drawn over that span (or border) water — Blåhaj may swim
// under these. We require the tile itself or an orthogonal neighbour to be open
// water so the on-island ends of a bridge aren't counted (the shark would
// otherwise "swim" onto dry land).
function computeBridgeTiles(m: MapDef): Set<string> {
  const tiles = new Set<string>();
  const bridgeLayers = m.baked?.layers.filter((l) => /bridge/i.test(l.name));
  if (!bridgeLayers || bridgeLayers.length === 0) return tiles;
  const isWater = (c: number, r: number) =>
    inB(m, c, r) && m.groundLayer[r][c] === WATER;
  for (const layer of bridgeLayers) {
    for (let i = 0; i < layer.data.length; i++) {
      if (!layer.data[i]) continue;
      const c = i % m.cols;
      const r = (i / m.cols) | 0;
      if (
        isWater(c, r) ||
        isWater(c - 1, r) ||
        isWater(c + 1, r) ||
        isWater(c, r - 1) ||
        isWater(c, r + 1)
      )
        tiles.add(`${c},${r}`);
    }
  }
  return tiles;
}

function injectExtras(m: MapDef) {
  const taken = new Set<string>([`${m.spawnPoint.cx},${m.spawnPoint.cy}`]);
  for (const n of m.npcs) taken.add(`${n.cx},${n.cy}`);

  // Leave-village portal, a few tiles from spawn so the player doesn't land on it.
  const portal = nearestWalkable(
    m,
    { cx: m.spawnPoint.cx, cy: m.spawnPoint.cy + 3 },
    (c, r) => walkable(m, c, r) && !taken.has(`${c},${r}`),
  );
  if (portal) {
    m.portal = portal;
    taken.add(`${portal.cx},${portal.cy}`);
  }

  // Pip (project board) — only if the maps didn't already place a projects NPC.
  if (!m.npcs.some((n) => n.panel === "projects")) {
    const spot = nearestWalkable(
      m,
      { cx: m.spawnPoint.cx + 2, cy: m.spawnPoint.cy },
      (c, r) => walkable(m, c, r) && !taken.has(`${c},${r}`),
    );
    if (spot) {
      const pip: NpcDef = {
        id: "curator_pip",
        cx: spot.cx,
        cy: spot.cy,
        name: "Pip",
        sprite: 4,
        dialogue: ["(Pip opens the project board.)"],
        panel: "projects",
      };
      m.npcs.push(pip);
    }
  }
}
