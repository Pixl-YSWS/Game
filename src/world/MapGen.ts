import type { MapDef, NpcDef, MapObject } from "../types/map";
import {
  GRASS,
  GRASS_DARK,
  PATH,
  WATER,
  SOLID,
  FLOWER_IDS,
  ROCK_IDS,
  TS,
  WALKABLE_GROUND,
  SOLID_DECO,
  FLAT_DECO,
  treeObject,
  treeSolidCells,
  houseObject,
  houseSolidCells,
  houseDoorCells,
  HOUSE_H,
  cowObject,
  cowSolidCells,
  chickenObject,
  fenceObject,
  FENCE,
  grassPatchObject,
} from "./tileset";

// Mulberry32 — fast, good-quality seeded PRNG
function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}
function ri(rng: () => number, n: number): number {
  return Math.floor(rng() * n);
}

const COLS = 30;
const ROWS = 22;
const BORDER = 2; // solid forest band around the playable area

// Where houses can sit (top-left anchors), left→right across the upper area.
const HOUSE_SLOTS = [
  { x: 4, y: 3 },
  { x: 12, y: 3 },
  { x: 20, y: 3 },
];
const HOUSE_DOOR_ROW = 3 + HOUSE_H - 1; // bottom row of a house at y=3 → row 8
const MAIN_PATH_ROW = HOUSE_DOOR_ROW + 2; // road running below the houses

// Build a cozy CozyValley village/town from a seed. Grass everywhere, a forest
// border, a path network, a few houses (each a multi-tile object with a working
// door), scattered flowers/rocks, villagers, and an optional world portal.
export function generateMap(
  seed: number,
  options: { houses?: boolean; sharedHouse?: boolean; portal?: "spawn" | "bottomRight" } = {},
): MapDef {
  const { houses = true, sharedHouse = false, portal: portalKind } = options;
  const rng = seededRng(seed);

  const ground: number[][] = Array.from({ length: ROWS }, () => new Array(COLS).fill(GRASS));
  const deco: number[][] = Array.from({ length: ROWS }, () => new Array(COLS).fill(-1));
  const objects: MapObject[] = [];
  const doors: { cx: number; cy: number }[] = [];

  const inB = (c: number, r: number) => c >= 0 && r >= 0 && c < COLS && r < ROWS;
  const setSolid = (c: number, r: number) => {
    if (inB(c, r)) deco[r][c] = SOLID;
  };
  const setPath = (c: number, r: number) => {
    if (inB(c, r) && deco[r][c] !== SOLID) ground[r][c] = PATH;
  };

  // ── Forest border: solid 2-tile band, decorated with overhanging trees ──
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c < BORDER || c >= COLS - BORDER || r < BORDER || r >= ROWS - BORDER) setSolid(c, r);
    }
  }
  for (let c = 0; c < COLS - 1; c += 2) {
    objects.push(treeObject(ri(rng, 4), c, 0));
    objects.push(treeObject(ri(rng, 4), c, ROWS - 3));
  }
  for (let r = 2; r < ROWS - 3; r += 3) {
    objects.push(treeObject(ri(rng, 4), 0, r));
    objects.push(treeObject(ri(rng, 4), COLS - 2, r));
  }

  // ── Houses ───────────────────────────────────────────────────────────
  const slots = houses ? HOUSE_SLOTS : sharedHouse ? HOUSE_SLOTS.slice(0, 1) : [];
  slots.forEach((slot, i) => {
    objects.push(houseObject(i, slot.x, slot.y));
    for (const [c, r] of houseSolidCells(slot.x, slot.y)) setSolid(c, r);
    const door = houseDoorCells(slot.x, slot.y);
    // The door cells are the walkable doorway (clear any solid we just set).
    for (const [c, r] of door) if (inB(c, r)) deco[r][c] = -1;
    // Step-down path from the doorway to the main road so the door is reachable.
    const dc = door[0][0];
    for (let r = HOUSE_DOOR_ROW; r <= MAIN_PATH_ROW; r++) setPath(dc, r);
    // Entering fires when you step onto the doorway tile.
    doors.push({ cx: door[0][0], cy: door[0][1] });
  });

  // ── Path network ───────────────────────────────────────────────────────
  // Main road below the houses, plus a lane down to the spawn.
  for (let c = BORDER; c < COLS - BORDER; c++) setPath(c, MAIN_PATH_ROW);
  const spawn = { cx: Math.floor(COLS / 2), cy: ROWS - 6 };
  for (let r = MAIN_PATH_ROW; r <= spawn.cy; r++) setPath(spawn.cx, r);

  // ── Scatter flowers + rocks on open grass ──────────────────────────────
  const isOpenGrass = (c: number, r: number) =>
    inB(c, r) && ground[r][c] === GRASS && deco[r][c] === -1;
  for (let n = 0; n < 26; n++) {
    const c = BORDER + ri(rng, COLS - BORDER * 2);
    const r = BORDER + ri(rng, ROWS - BORDER * 2);
    if (!isOpenGrass(c, r)) continue;
    const pool = rng() < 0.7 ? FLOWER_IDS : ROCK_IDS;
    deco[r][c] = pool[ri(rng, pool.length)];
  }

  // ── World-switch portal ────────────────────────────────────────────────
  const doorSet = new Set(doors.map((d) => `${d.cx},${d.cy}`));
  const walkable = (c: number, r: number) => {
    if (!inB(c, r) || doorSet.has(`${c},${r}`)) return false;
    if (!WALKABLE_GROUND.has(ground[r][c])) return false;
    const d = deco[r][c];
    return !(d >= 0 && SOLID_DECO.has(d));
  };
  let portal: { cx: number; cy: number } | undefined;
  if (portalKind) {
    const anchor =
      portalKind === "bottomRight"
        ? { cx: COLS - 4, cy: ROWS - 4 }
        : { cx: spawn.cx + 2, cy: spawn.cy };
    portal = nearestWalkable(anchor, walkable, COLS, ROWS);
  }

  const reserved = new Set<string>([`${spawn.cx},${spawn.cy}`]);
  if (portal) reserved.add(`${portal.cx},${portal.cy}`);
  const npcs = placeVillagers(spawn, walkable, rng, reserved);

  return {
    key: `world_${seed}`,
    cols: COLS,
    rows: ROWS,
    cozy: true,
    tilesetKey: TS.terrain, // unused for cozy maps (registry-resolved)
    tilesetCols: 16,
    groundLayer: ground,
    decoLayer: deco,
    objects,
    walkableGround: WALKABLE_GROUND,
    solidDeco: SOLID_DECO,
    flatDeco: FLAT_DECO,
    spawnPoint: spawn,
    doors,
    portal,
    npcs,
  };
}

// ── Fixed village ─────────────────────────────────────────────────────────
// A single hand-authored island layout, identical for every player (the seed
// is intentionally ignored — the seed plumbing still exists on the server so
// per-player random villages can be switched back on later). Composition: a
// water border with a sandy shore, a blue-roof house top-right, a red-roof
// house bottom-left, a fenced chicken pen top-left, a dirt path network, a
// little herd of cows + chickens, scattered trees, and a portal to the open
// world.
const V_COLS = 30;
const V_ROWS = 22;

export function generateVillage(): MapDef {
  const ground: number[][] = Array.from({ length: V_ROWS }, () => new Array(V_COLS).fill(GRASS));
  const deco: number[][] = Array.from({ length: V_ROWS }, () => new Array(V_COLS).fill(-1));
  const objects: MapObject[] = [];
  const doors: { cx: number; cy: number }[] = [];
  // Deterministic RNG only for cosmetic flower/rock scatter — the structural
  // layout below is fully fixed.
  const rng = seededRng(0x5eed1e);

  const inB = (c: number, r: number) => c >= 0 && r >= 0 && c < V_COLS && r < V_ROWS;
  const setSolid = (c: number, r: number) => {
    if (inB(c, r)) deco[r][c] = SOLID;
  };
  const setPath = (c: number, r: number) => {
    if (inB(c, r) && deco[r][c] !== SOLID && ground[r][c] !== WATER) ground[r][c] = PATH;
  };

  // ── Water border + sandy shore ─────────────────────────────────────────
  // Ring distance from the nearest edge: 0–1 = water (impassable), 2 = shore.
  for (let r = 0; r < V_ROWS; r++) {
    for (let c = 0; c < V_COLS; c++) {
      const d = Math.min(c, r, V_COLS - 1 - c, V_ROWS - 1 - r);
      if (d < 2) ground[r][c] = WATER;
      else if (d === 2) ground[r][c] = PATH; // shore (same tan tile as paths)
    }
  }

  // ── Houses ──────────────────────────────────────────────────────────────
  const placeHouse = (variant: number, x: number, y: number) => {
    objects.push(houseObject(variant, x, y));
    for (const [c, r] of houseSolidCells(x, y)) setSolid(c, r);
    const door = houseDoorCells(x, y);
    for (const [c, r] of door) {
      if (inB(c, r)) deco[r][c] = -1; // doorway is walkable
      doors.push({ cx: c, cy: r });
    }
  };
  placeHouse(0, 21, 3); // blue roof, top-right → door (23,8)/(24,8)
  placeHouse(3, 4, 12); // red roof, bottom-left → door (6,17)/(7,17)

  // ── Fenced chicken pen, top-left ────────────────────────────────────────
  const pen = { x0: 4, y0: 3, x1: 10, y1: 7 };
  for (let c = pen.x0; c <= pen.x1; c++) {
    const top = c === pen.x0 ? FENCE.TL : c === pen.x1 ? FENCE.TR : FENCE.TOP;
    const bot = c === pen.x0 ? FENCE.BL : c === pen.x1 ? FENCE.BR : FENCE.BOTTOM;
    objects.push(fenceObject(top, c, pen.y0));
    objects.push(fenceObject(bot, c, pen.y1));
    setSolid(c, pen.y0);
    setSolid(c, pen.y1);
  }
  for (let r = pen.y0 + 1; r < pen.y1; r++) {
    objects.push(fenceObject(FENCE.LEFT, pen.x0, r));
    objects.push(fenceObject(FENCE.RIGHT, pen.x1, r));
    setSolid(pen.x0, r);
    setSolid(pen.x1, r);
  }
  objects.push(chickenObject(7, 5)); // a chicken pecking inside the pen

  // ── Dirt path ───────────────────────────────────────────────────────────
  // A simple 2-tile-wide trail linking the two house doors. The organic edges
  // come from the sand rendering (tufts), so the path itself stays tidy.
  const pathH = (c0: number, c1: number, r: number, w = 2) => {
    for (let c = c0; c <= c1; c++) for (let dr = 0; dr < w; dr++) setPath(c, r + dr);
  };
  const pathV = (c: number, r0: number, r1: number, w = 2) => {
    for (let r = r0; r <= r1; r++) for (let dc = 0; dc < w; dc++) setPath(c + dc, r);
  };
  pathV(23, 9, 10); // blue house door (row 8) down to the main trail
  pathH(10, 24, 10); // main east–west trail
  pathV(10, 10, 18); // lane down the east side of the red house
  pathH(6, 11, 18, 1); // along the bottom to the red house door

  // ── Animals ─────────────────────────────────────────────────────────────
  const placeCow = (anim: "idle" | "graze" | "lie", c: number, r: number) => {
    objects.push(cowObject(anim, c, r));
    for (const [cc, rr] of cowSolidCells(c, r)) setSolid(cc, rr);
  };
  placeCow("graze", 17, 12); // grazing in the middle
  placeCow("lie", 19, 15); // resting on the dark grass
  placeCow("lie", 22, 16);
  objects.push(chickenObject(21, 14));
  objects.push(chickenObject(24, 16));

  // ── Trees ───────────────────────────────────────────────────────────────
  const canPlaceTree = (c: number, r: number) => {
    for (const [cc, rr] of [[c, r], [c + 1, r], [c, r + 1], [c + 1, r + 1], [c, r + 2], [c + 1, r + 2]]) {
      if (!inB(cc, rr)) return false;
      if (ground[rr][cc] === WATER) return false;
      const d = deco[rr][cc];
      if (d >= 0 && SOLID_DECO.has(d)) return false;
    }
    return true;
  };
  for (const [c, r, v] of [
    [12, 3, 0], [19, 3, 1], [17, 5, 2], [25, 10, 3],
    [14, 13, 0], [12, 10, 1], [25, 15, 2], [16, 16, 3],
  ] as const) {
    if (!canPlaceTree(c, r)) continue;
    objects.push(treeObject(v, c, r));
    for (const [cc, rr] of treeSolidCells(c, r)) setSolid(cc, rr);
  }

  // ── Grass-patch decals: soft light blobs to break up the flat grass ──────
  for (const [c, r] of [
    [13, 4], [8, 11], [16, 6], [3, 8], [20, 13], [14, 16], [24, 6], [19, 15],
  ] as const) {
    if (ground[r]?.[c] === GRASS) objects.push(grassPatchObject("light", c, r));
  }

  // ── Cosmetic flower/rock scatter on open grass ──────────────────────────
  const isOpenGrass = (c: number, r: number) =>
    inB(c, r) && (ground[r][c] === GRASS || ground[r][c] === GRASS_DARK) && deco[r][c] === -1;
  for (let n = 0; n < 22; n++) {
    const c = 3 + ri(rng, V_COLS - 6);
    const r = 3 + ri(rng, V_ROWS - 6);
    if (!isOpenGrass(c, r)) continue;
    const pool = rng() < 0.7 ? FLOWER_IDS : ROCK_IDS;
    deco[r][c] = pool[ri(rng, pool.length)];
  }

  // ── Spawn, portal, villagers ────────────────────────────────────────────
  const spawn = { cx: 15, cy: 12 };
  const doorSet = new Set(doors.map((d) => `${d.cx},${d.cy}`));
  const walkable = (c: number, r: number) => {
    if (!inB(c, r) || doorSet.has(`${c},${r}`)) return false;
    if (!WALKABLE_GROUND.has(ground[r][c])) return false;
    const d = deco[r][c];
    return !(d >= 0 && SOLID_DECO.has(d));
  };
  const portal = nearestWalkable({ cx: V_COLS - 4, cy: V_ROWS - 4 }, walkable, V_COLS, V_ROWS);

  // Villagers at fixed open tiles around spawn (clamped to walkable just in
  // case), so the shop + projects NPCs are always reachable.
  const reserved = new Set<string>([`${spawn.cx},${spawn.cy}`]);
  if (portal) reserved.add(`${portal.cx},${portal.cy}`);
  const fixedSpots = [
    { cx: 13, cy: 12 }, { cx: 17, cy: 11 }, { cx: 16, cy: 13 }, { cx: 14, cy: 14 },
  ];
  const npcs: NpcDef[] = [];
  VILLAGER_TEMPLATES.forEach((tpl, i) => {
    let spot = fixedSpots[i];
    if (!spot || !walkable(spot.cx, spot.cy) || reserved.has(`${spot.cx},${spot.cy}`)) {
      const found = nearestWalkable(spawn, (c, r) => walkable(c, r) && !reserved.has(`${c},${r}`), V_COLS, V_ROWS);
      if (!found) return;
      spot = found;
    }
    reserved.add(`${spot.cx},${spot.cy}`);
    npcs.push({ ...tpl, cx: spot.cx, cy: spot.cy });
  });

  return {
    key: "village_fixed",
    cols: V_COLS,
    rows: V_ROWS,
    cozy: true,
    tilesetKey: TS.terrain,
    tilesetCols: 16,
    groundLayer: ground,
    decoLayer: deco,
    objects,
    walkableGround: WALKABLE_GROUND,
    solidDeco: SOLID_DECO,
    flatDeco: FLAT_DECO,
    spawnPoint: spawn,
    doors,
    portal,
    npcs,
  };
}

// Villager templates. `sprite` is legacy (NPCs now derive their CozyValley look
// from their id); kept so existing NpcDef consumers still type-check.
const VILLAGER_TEMPLATES: Omit<NpcDef, "cx" | "cy">[] = [
  {
    id: "villager_quill",
    name: "Quill",
    sprite: 0,
    dialogue: [
      "Hi there! Welcome to the village.",
      "Folks say the merchant down south is hiring for odd jobs.",
      "Take these — first meeting deserves a tip.",
    ],
    reward: 5,
  },
  {
    id: "villager_mara",
    name: "Mara",
    sprite: 0,
    dialogue: ["Watch your step around the houses.", "Some doors lead to places you've never been."],
    reward: 3,
  },
  {
    id: "merchant_oda",
    name: "Oda",
    sprite: 0,
    dialogue: ["(Oda opens her shop.)"],
    shopId: "village_shop",
  },
  {
    id: "curator_pip",
    name: "Pip",
    sprite: 0,
    dialogue: ["(Pip opens the project board.)"],
    panel: "projects",
  },
];

// Expanding-ring search outward from `anchor` for the first tile passing `ok`.
function nearestWalkable(
  anchor: { cx: number; cy: number },
  ok: (c: number, r: number) => boolean,
  cols: number,
  rows: number,
): { cx: number; cy: number } | undefined {
  const maxR = Math.max(cols, rows);
  for (let radius = 0; radius <= maxR; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const c = anchor.cx + dx;
        const r = anchor.cy + dy;
        if (ok(c, r)) return { cx: c, cy: r };
      }
    }
  }
  return undefined;
}

// Place villagers on open tiles a few steps out from spawn, deterministically.
function placeVillagers(
  spawn: { cx: number; cy: number },
  walkable: (c: number, r: number) => boolean,
  rng: () => number,
  reserved: ReadonlySet<string>,
): NpcDef[] {
  const occupied = new Set<string>(reserved);
  const npcs: NpcDef[] = [];
  for (const tpl of VILLAGER_TEMPLATES) {
    let placed = false;
    for (let radius = 2; radius < 10 && !placed; radius++) {
      for (let t = 0; t < 16; t++) {
        const angle = rng() * Math.PI * 2;
        const cx = Math.round(spawn.cx + Math.cos(angle) * radius);
        const cy = Math.round(spawn.cy + Math.sin(angle) * radius);
        if (!walkable(cx, cy) || occupied.has(`${cx},${cy}`)) continue;
        occupied.add(`${cx},${cy}`);
        npcs.push({ ...tpl, cx, cy });
        placed = true;
        break;
      }
    }
  }
  return npcs;
}
