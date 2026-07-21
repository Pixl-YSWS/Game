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
  matchCollisionToSprites(m);
  m.bridgeTiles = computeBridgeTiles(m);

  // Blahaj — only where the spot is actually open water on the current map.
  m.objects = m.objects ?? [];
  for (const [cx, cy] of BLAHAJ_SPOTS) {
    if (m.groundLayer[cy]?.[cx] === WATER) m.objects.push(sharkObject(cx, cy));
  }

  return m;
}

// Tall sprites (trees, houses, barn, tents) are drawn full-height but the
// baked collision marks their whole footprint solid — so players get blocked
// by canopies and roof peaks tiles above the actual body. Each tall tileset
// declares `spriteRows` (sprite height in tile rows) and `solidRows` (how many
// bottom rows are the physical body: trunk, walls). A tile's local row within
// its tileset tells how far above the sprite's base it sits, so we can clear
// the painted collision on every cell whose stamped tiles are all
// canopy/roof — collision then matches what's actually drawn there.
const GID_MASK = 0x1fffffff;

function matchCollisionToSprites(m: MapDef) {
  const baked = m.baked;
  if (!baked) return;
  const { cols, rows } = m;

  // true → this tile's art physically stands on the ground here (per the
  // tileset's pixel-derived solidLocals). Tilesets without the metadata
  // (fences/props/bridges) keep whatever collision was painted; flat
  // ground-decor tilesets (grass patches) never want collision.
  const solidSets = new Map<string, Set<number>>();
  for (const t of baked.tilesets)
    if (t.solidLocals) solidSets.set(t.key, new Set(t.solidLocals));

  const wantsCollision = (gidRaw: number): boolean => {
    const gid = gidRaw & GID_MASK;
    let best: (typeof baked.tilesets)[number] | undefined;
    for (const t of baked.tilesets)
      if (gid >= t.firstgid && gid < t.firstgid + t.count)
        if (!best || t.firstgid > best.firstgid) best = t;
    if (!best) return true;
    if (best.flat) return false;
    const solids = solidSets.get(best.key);
    if (!solids) return true;
    return solids.has(gid - best.firstgid);
  };

  for (let i = 0; i < cols * rows; i++) {
    const c = i % cols;
    const r = (i / cols) | 0;
    if (m.decoLayer[r][c] !== 99) continue;
    // Only object layers vote: flat layers (ground/water/bridge) drive
    // walkability via groundLayer, and hand-painted blockers with no object
    // tile (e.g. invisible walls along water) must stay.
    let hasObjectTile = false;
    let keep = false;
    for (const l of baked.layers) {
      if (!l.perRow) continue;
      const raw = l.data[i];
      if (!raw) continue;
      hasObjectTile = true;
      if (wantsCollision(raw)) {
        keep = true;
        break;
      }
    }
    if (hasObjectTile && !keep) m.decoLayer[r][c] = -1;
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
