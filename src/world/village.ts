import type { MapDef, NpcDef } from "../types/map";
import { MAIN_HUB, HOME_TOWN } from "../data/villageMaps";

// The village is two hand-authored Tiled maps joined by a bridge.
export type VillageArea = "hub" | "town";
export const DEFAULT_AREA: VillageArea = "hub";

export function villageArea(world: { area?: VillageArea }): VillageArea {
  return world.area ?? DEFAULT_AREA;
}

interface Cell {
  cx: number;
  cy: number;
}

/**
 * Bridge crossings. Stepping onto one of `cells` in `area` moves the player to
 * `to`, arriving at `arrive`. home_town's only off-map walkway is its west-edge
 * bridge stub at (0,8)/(0,9); main_hub has no edge bridge, so its bottom-island
 * path tip (col 24, rows 29–32 — beside Oda) is the matching gateway. Adjust
 * these coordinates if you redraw the maps.
 */
export interface BridgeLink {
  area: VillageArea;
  cells: Cell[];
  to: VillageArea;
  arrive: Cell;
}

export const BRIDGE_LINKS: BridgeLink[] = [
  {
    area: "town",
    cells: [
      { cx: 0, cy: 8 },
      { cx: 0, cy: 9 },
    ],
    to: "hub",
    arrive: { cx: 23, cy: 30 },
  },
  {
    area: "hub",
    cells: [
      { cx: 24, cy: 29 },
      { cx: 24, cy: 30 },
      { cx: 24, cy: 31 },
      { cx: 24, cy: 32 },
    ],
    to: "town",
    arrive: { cx: 2, cy: 8 },
  },
];

/** The crossing triggered by standing on (cx,cy) in `area`, if any. */
export function bridgeAt(
  area: VillageArea,
  cx: number,
  cy: number,
): BridgeLink | undefined {
  return BRIDGE_LINKS.find(
    (l) => l.area === area && l.cells.some((c) => c.cx === cx && c.cy === cy),
  );
}

/** Where a player lands when crossing from `from` into `to`. */
export function bridgeArrival(
  from: VillageArea,
  to: VillageArea,
): Cell | undefined {
  return BRIDGE_LINKS.find((l) => l.area === from && l.to === to)?.arrive;
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
 * A fresh, deep-enough copy of a village area's map. The loaded map gets mutated
 * in place (animals are pulled out of `objects`, edits paint the layers), so
 * callers must never share the module singleton. The big read-only
 * `baked.layers[].data` GID arrays are never mutated, so they're shared.
 *
 * The hub also gets a leave-village portal and the Pip project-board NPC
 * injected, since those aren't drawn into the Tiled maps.
 */
export function villageMap(area: VillageArea = DEFAULT_AREA): MapDef {
  const src = area === "town" ? HOME_TOWN : MAIN_HUB;
  const m: MapDef = {
    ...src,
    groundLayer: src.groundLayer.map((r) => [...r]),
    decoLayer: src.decoLayer.map((r) => [...r]),
    objects: src.objects?.map((o) => ({
      ...o,
      frames: o.frames?.map((f) => ({ ...f })),
    })),
    npcs: src.npcs.map((n) => ({ ...n, dialogue: [...n.dialogue] })),
    spawnPoint: { ...src.spawnPoint },
    doors: src.doors.map((d) => ({ ...d })),
    baked: src.baked && {
      ...src.baked,
      tilesets: src.baked.tilesets.map((t) => ({ ...t })),
      layers: src.baked.layers.map((l) => ({ ...l })),
    },
  };

  if (area === "hub") injectHubExtras(m);
  return m;
}

function injectHubExtras(m: MapDef) {
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
