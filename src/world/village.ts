import type { MapDef, NpcDef } from "../types/map";
import { VILLAGE } from "../data/villageMaps";

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
  return m;
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
