// Seeded per-house interior generator. Phaser-free so it can be tested (and
// potentially reused by the server) without a browser.
import type { MapDef, MapObject } from "../types/map";
import {
  SOLID,
  IPROPS,
  interiorPropObject,
  interiorPropsKey,
  INTERIOR_COLORS,
  IFLOOR_COLOR_IDS,
  IWALL_COLOR_IDS,
  type InteriorProp,
} from "./tileset";

const COLS = 32;
const ROWS = 18;

// Same tiny fast hash/PRNG as MapGen (mulberry32-style).
function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

export interface InteriorLayout {
  map: MapDef;
  roomX: number;
  roomY: number;
  roomCols: number;
  roomRows: number;
  doorCol: number;
  doorRow: number;
}

/**
 * Every house gets its own interior, generated from a seed derived from the
 * house's door tile (and village owner): room size, wall/floor colour theme
 * and furniture arrangement all vary per house but stay stable across visits.
 *
 * A rare furniture roll can wall off a floor pocket, so generation re-rolls
 * (deterministically) until every walkable cell is reachable from the spawn.
 */
export function makeInteriorMap(seed: number): InteriorLayout {
  let layout = generateInterior(seed);
  for (
    let attempt = 1;
    attempt < 8 && !fullyReachable(layout.map);
    attempt++
  ) {
    layout = generateInterior((seed + attempt * 0x9e3779b9) >>> 0);
  }
  return layout;
}

function fullyReachable(map: MapDef): boolean {
  const walkable = (c: number, r: number) => {
    const g = map.groundLayer[r]?.[c];
    if (g === undefined || !map.walkableGround.has(g)) return false;
    const d = map.decoLayer[r]?.[c];
    return !(d >= 0 && map.solidDeco.has(d));
  };
  const s = map.spawnPoint;
  if (!walkable(s.cx, s.cy)) return false;
  const seen = new Set<string>([`${s.cx},${s.cy}`]);
  const stack = [[s.cx, s.cy]];
  while (stack.length) {
    const [c, r] = stack.pop()!;
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nc = c + dc;
      const nr = r + dr;
      if (walkable(nc, nr) && !seen.has(`${nc},${nr}`)) {
        seen.add(`${nc},${nr}`);
        stack.push([nc, nr]);
      }
    }
  }
  let total = 0;
  for (let r = 0; r < map.rows; r++)
    for (let c = 0; c < map.cols; c++) if (walkable(c, r)) total++;
  return seen.size === total;
}

function generateInterior(seed: number): InteriorLayout {
  const rng = seededRng(seed);
  const ri = (n: number) => Math.floor(rng() * n);

  const roomCols = 14 + 2 * ri(3); // 14 / 16 / 18
  const roomRows = 10 + ri(3); // 10-12
  const roomX = Math.floor((COLS - roomCols) / 2);
  const roomY = Math.floor((ROWS - roomRows) / 2);
  const roomX1 = roomX + roomCols - 1;
  const roomY1 = roomY + roomRows - 1;
  const doorCol = roomX + Math.floor(roomCols / 2);
  const doorRow = roomY1;

  const color = INTERIOR_COLORS[ri(INTERIOR_COLORS.length)];
  const floorId = IFLOOR_COLOR_IDS[color];
  const wallId = IWALL_COLOR_IDS[color];
  const propsKey = interiorPropsKey(color);

  const ground = Array.from({ length: ROWS }, () => new Array(COLS).fill(-1));
  const deco = Array.from({ length: ROWS }, () => new Array(COLS).fill(-1));

  // Floor across the whole room.
  for (let r = roomY; r <= roomY1; r++)
    for (let c = roomX; c <= roomX1; c++) ground[r][c] = floorId;

  // Wallpaper walls: a 2-tile-tall back wall plus a 1-tile border on the other
  // sides, with a doorway gap at the bottom centre.
  for (let c = roomX; c <= roomX1; c++) {
    deco[roomY][c] = wallId;
    deco[roomY + 1][c] = wallId;
    if (c !== doorCol) deco[roomY1][c] = wallId;
  }
  for (let r = roomY; r <= roomY1; r++) {
    deco[r][roomX] = wallId;
    deco[r][roomX1] = wallId;
  }

  const objects: MapObject[] = [];
  // Occupancy of interior floor cells (walls excluded) so furniture never
  // overlaps; the door column below the table zone stays clear by placement
  // rules (big furniture hugs the back wall, nothing sits on the bottom row).
  const used = new Set<string>();
  const tileW = (p: InteriorProp) => Math.max(1, Math.round(p.w / 16));
  const tileH = (p: InteriorProp) => Math.max(1, Math.round(p.h / 16));

  const place = (
    prop: InteriorProp,
    cx: number,
    cy: number,
    opts: { flat?: boolean; solid?: boolean } = {},
  ) => {
    objects.push(interiorPropObject(prop, cx, cy, opts.flat, propsKey));
    for (let r = 0; r < tileH(prop); r++)
      for (let c = 0; c < tileW(prop); c++) {
        const gc = cx + c;
        const gr = cy + r;
        used.add(`${gc},${gr}`);
        if (
          opts.solid &&
          gr > roomY + 1 &&
          gr < roomY1 &&
          gc > roomX &&
          gc < roomX1
        )
          deco[gr][gc] = SOLID;
      }
  };

  const fits = (prop: InteriorProp, cx: number, cy: number) => {
    for (let r = 0; r < tileH(prop); r++)
      for (let c = 0; c < tileW(prop); c++) {
        const gc = cx + c;
        const gr = cy + r;
        if (gc <= roomX || gc >= roomX1 || gr <= roomY + 1 || gr >= roomY1)
          return false;
        if (used.has(`${gc},${gr}`)) return false;
      }
    return true;
  };

  // Wall decorations along the back wall (no collision).
  for (let c = roomX + 2 + ri(2); c < roomX1 - 2; c += 4 + ri(3)) {
    place(rng() < 0.7 ? IPROPS.window : IPROPS.picture, c, roomY);
  }

  // Big furniture lines up under the back wall, left to right.
  const bed = rng() < 0.6 ? IPROPS.bedDouble : IPROPS.bedSingle;
  const lineup: InteriorProp[] = [IPROPS.bookshelf, IPROPS.wardrobe, bed];
  if (rng() < 0.5) lineup.push(IPROPS.sofa);
  // Seeded order.
  for (let i = lineup.length - 1; i > 0; i--) {
    const j = ri(i + 1);
    [lineup[i], lineup[j]] = [lineup[j], lineup[i]];
  }
  let x = roomX + 1 + ri(2);
  for (const prop of lineup) {
    if (x + tileW(prop) >= roomX1) break;
    if (fits(prop, x, roomY + 2)) {
      place(prop, x, roomY + 2, { solid: true });
      x += tileW(prop) + 1 + ri(2);
    } else {
      x += 1;
    }
  }

  // Rug + table near the middle of the open floor.
  for (let attempt = 0; attempt < 8; attempt++) {
    const tx = roomX + 2 + ri(Math.max(1, roomCols - 6));
    const ty = roomY + 5 + ri(Math.max(1, roomRows - 9));
    if (!fits(IPROPS.table, tx, ty)) continue;
    place(IPROPS.rug, tx - 1, ty, { flat: true });
    place(IPROPS.table, tx, ty, { solid: true });
    break;
  }

  // A lamp in one bottom corner.
  const lampX = rng() < 0.5 ? roomX + 1 : roomX1 - 1;
  if (fits(IPROPS.lamp, lampX, roomY1 - 2))
    place(IPROPS.lamp, lampX, roomY1 - 2, { solid: true });

  const map: MapDef = {
    key: `interior_${seed >>> 0}`,
    cols: COLS,
    rows: ROWS,
    tilesetKey: "tiles-town",
    tilesetCols: 12,
    cozy: true,
    objects,
    groundLayer: ground,
    decoLayer: deco,
    walkableGround: new Set([floorId]),
    solidDeco: new Set([SOLID, wallId]),
    flatDeco: new Set(),
    spawnPoint: { cx: doorCol, cy: doorRow - 1 },
    doors: [],
    npcs: [],
  };
  return { map, roomX, roomY, roomCols, roomRows, doorCol, doorRow };
}

