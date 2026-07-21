// MOSTLY WRITTEN BY CLAUDE
// MAP STUFF IS MOSTLY WRITTEN BY CLAUDE

import type { MapDef, NpcDef, MapObject } from "../types/map";
import {
  GRASS,
  PATH,
  SOLID,
  FLOWER_IDS,
  ROCK_IDS,
  TS,
  WALKABLE_GROUND,
  SOLID_DECO,
  FLAT_DECO,
  treeObject,
  houseObject,
  houseSolidCells,
  houseDoorCells,
  HOUSE_H,
} from "./tileset";

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
const BORDER = 2;

const HOUSE_SLOTS = [
  { x: 4, y: 3 },
  { x: 12, y: 3 },
  { x: 20, y: 3 },
];
const HOUSE_DOOR_ROW = 3 + HOUSE_H - 1;
const MAIN_PATH_ROW = HOUSE_DOOR_ROW + 2;

export function generateMap(
  seed: number,
  options: {
    houses?: boolean;
    sharedHouse?: boolean;
    portal?: "spawn" | "bottomRight";
  } = {},
): MapDef {
  const { houses = true, sharedHouse = false, portal: portalKind } = options;
  const rng = seededRng(seed);

  const ground: number[][] = Array.from({ length: ROWS }, () =>
    new Array(COLS).fill(GRASS),
  );
  const deco: number[][] = Array.from({ length: ROWS }, () =>
    new Array(COLS).fill(-1),
  );
  const objects: MapObject[] = [];
  const doors: { cx: number; cy: number }[] = [];

  const inB = (c: number, r: number) =>
    c >= 0 && r >= 0 && c < COLS && r < ROWS;
  const setSolid = (c: number, r: number) => {
    if (inB(c, r)) deco[r][c] = SOLID;
  };
  const setPath = (c: number, r: number) => {
    if (inB(c, r) && deco[r][c] !== SOLID) ground[r][c] = PATH;
  };

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c < BORDER || c >= COLS - BORDER || r < BORDER || r >= ROWS - BORDER)
        setSolid(c, r);
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

  const slots = houses
    ? HOUSE_SLOTS
    : sharedHouse
      ? HOUSE_SLOTS.slice(0, 1)
      : [];
  slots.forEach((slot, i) => {
    objects.push(houseObject(i, slot.x, slot.y));
    for (const [c, r] of houseSolidCells(slot.x, slot.y)) setSolid(c, r);
    const door = houseDoorCells(slot.x, slot.y);

    for (const [c, r] of door) if (inB(c, r)) deco[r][c] = -1;

    const dc = door[0][0];
    for (let r = HOUSE_DOOR_ROW; r <= MAIN_PATH_ROW; r++) setPath(dc, r);

    doors.push({ cx: door[0][0], cy: door[0][1] });
  });

  for (let c = BORDER; c < COLS - BORDER; c++) setPath(c, MAIN_PATH_ROW);
  const spawn = { cx: Math.floor(COLS / 2), cy: ROWS - 6 };
  for (let r = MAIN_PATH_ROW; r <= spawn.cy; r++) setPath(spawn.cx, r);

  const isOpenGrass = (c: number, r: number) =>
    inB(c, r) && ground[r][c] === GRASS && deco[r][c] === -1;
  for (let n = 0; n < 26; n++) {
    const c = BORDER + ri(rng, COLS - BORDER * 2);
    const r = BORDER + ri(rng, ROWS - BORDER * 2);
    if (!isOpenGrass(c, r)) continue;
    const pool = rng() < 0.7 ? FLOWER_IDS : ROCK_IDS;
    deco[r][c] = pool[ri(rng, pool.length)];
  }

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
    dialogue: [
      "Watch your step around the houses.",
      "Some doors lead to places you've never been.",
    ],
    reward: 3,
  },
  {
    id: "merchant_oda",
    name: "Gabin",
    sprite: 0,
    dialogue: ["(Gabin opens his shop.)"],
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
