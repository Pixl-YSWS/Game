import type { MapDef } from "../types/map";
import { PRESETS } from "./presets";

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

// House templates lifted from the original hand-authored map. Index 43 is
// a walkable archway tile (not in SOLID_DECO); everything else is wall.
const HOUSE_TEMPLATES: number[][][] = [
  // 3×3 small cottage
  [
    [96,  97,  98],
    [108, 109, 110],
    [120, 121, 122],
  ],
  // 4×3 medium house with vertical archway
  [
    [44, 45, 45, 45],
    [56, 94, 43, 94],
    [68, 82, 43, 80],
  ],
  // 5×4 multi-floor building
  [
    [48, 51, 49, 49, 50],
    [60, 61, 61, 63, 62],
    [72, 84, 73, 73, 75],
    [72, 73, 86, 87, 75],
  ],
  // 3×4 tall chimney house (top-right cluster A1 in the original)
  [
    [52, 53, 54],
    [64, 65, 66],
    [76, 88, 79],
    [76, 89, 79],
  ],
  // 3×3 short chimney house (top-right cluster A2 in the original)
  [
    [52, 53, 54],
    [64, 67, 66],
    [76, 89, 79],
  ],
];

// Door cell relative to each template's top-left, ALWAYS one tile south
// of the house's bottom edge (i.e., outside the footprint). Walking onto
// this tile in the world triggers entering the interior. The cell is
// stamped as a 43 stone path so it visually reads as a doorstep.
const TEMPLATE_DOORS: { dc: number; dr: number }[] = [
  { dc: 1, dr: 3 }, // small cottage  (3×3) → row baseY+3
  { dc: 2, dr: 3 }, // medium house   (4×3) → row baseY+3, under archway exit
  { dc: 2, dr: 4 }, // big building   (5×4) → row baseY+4
  { dc: 1, dr: 4 }, // tall chimney   (3×4) → row baseY+4
  { dc: 1, dr: 3 }, // short chimney  (3×3) → row baseY+3
];

function clone(layer: number[][]): number[][] {
  return layer.map(row => [...row]);
}

// Build a MapDef from a preset. The preset supplies the village backdrop
// (roads, paths, scenery); this function decides what house goes in each
// slot and where inside that slot it sits, giving every seed a different
// arrangement while keeping the overall village layout coherent.
export function generateMap(seed: number): MapDef {
  const rng = seededRng(seed);
  const preset = PRESETS[ri(rng, PRESETS.length)];

  const ground = clone(preset.ground);
  const deco = clone(preset.deco);

  // Track which templates we've already used so the same house isn't
  // stamped twice when there are unused alternatives that fit.
  const used = new Set<number>();
  const placed: { baseX: number; baseY: number; w: number; h: number }[] = [];
  const doors: { cx: number; cy: number }[] = [];
  for (const slot of preset.houseSlots) {
    const fits: { tpl: number[][]; idx: number }[] = [];
    HOUSE_TEMPLATES.forEach((tpl, idx) => {
      if (tpl[0].length <= slot.width && tpl.length <= slot.height) {
        fits.push({ tpl, idx });
      }
    });
    if (fits.length === 0) continue;

    let pool = fits.filter(f => !used.has(f.idx));
    if (pool.length === 0) pool = fits; // out of unused options, allow repeats

    const pick = pool[ri(rng, pool.length)];
    used.add(pick.idx);
    const tpl = pick.tpl;
    const w = tpl[0].length;
    const h = tpl.length;

    // Horizontal offset is random; vertical is bottom-aligned so houses
    // never leave an awkward empty strip below them and so their south
    // edge sits next to the existing path network.
    const ox = ri(rng, slot.width - w + 1);
    const oy = slot.height - h;
    const baseX = slot.x + ox;
    const baseY = slot.y + oy;

    for (let dr = 0; dr < h; dr++) {
      for (let dc = 0; dc < w; dc++) {
        deco[baseY + dr][baseX + dc] = tpl[dr][dc];
      }
    }
    placed.push({ baseX, baseY, w, h });
    const door = TEMPLATE_DOORS[pick.idx];
    doors.push({ cx: baseX + door.dc, cy: baseY + door.dr });
  }

  // ── Connect each house to the existing path network ──────────────
  // Some seeds will offset houses away from the original path endpoints,
  // leaving them stranded. For each placed house, find the nearest stone
  // path (43) or road (ground tile 1) and snake a path from the house's
  // closest-facing side until we hit it.
  // True if (c, r) is inside any house footprint — those tiles can be
  // 43 (the archway through a medium house), but they should NOT count
  // as a target for the connector since the house is the thing we want
  // to connect TO, not from.
  const insideAnyHouse = (c: number, r: number) =>
    placed.some(p => c >= p.baseX && c < p.baseX + p.w && r >= p.baseY && r < p.baseY + p.h);

  for (const { baseX, baseY, w, h } of placed) {
    const hcx = baseX + (w - 1) / 2;
    const hcy = baseY + (h - 1) / 2;

    // Prefer connecting to an existing 43 stone path. Only fall back to a
    // road tile if no path exists anywhere on the map — roads alone don't
    // give the visible stone-trail look we're after.
    const findClosest = (predicate: (c: number, r: number) => boolean) => {
      let best: { c: number; r: number } | null = null;
      let bestDist = Infinity;
      for (let r = 0; r < preset.rows; r++) {
        for (let c = 0; c < preset.cols; c++) {
          if (insideAnyHouse(c, r)) continue;
          if (!predicate(c, r)) continue;
          const d = Math.abs(c - hcx) + Math.abs(r - hcy);
          if (d < bestDist) { bestDist = d; best = { c, r }; }
        }
      }
      return best;
    };

    const target =
      findClosest((c, r) => deco[r][c] === 43) ??
      findClosest((c, r) => ground[r][c] === 1);
    if (!target) continue;

    // Step out of the house in the direction of the target
    const dx = target.c - hcx;
    const dy = target.r - hcy;
    let startC: number, startR: number;
    if (Math.abs(dx) > Math.abs(dy)) {
      startR = baseY + Math.floor(h / 2);
      startC = dx > 0 ? baseX + w : baseX - 1;
    } else {
      startC = baseX + Math.floor(w / 2);
      startR = dy > 0 ? baseY + h : baseY - 1;
    }

    let c = startC, r = startR;
    for (let step = 0; step < 15; step++) {
      if (c < 0 || r < 0 || c >= preset.cols || r >= preset.rows) break;
      if (ground[r][c] === 1 || deco[r][c] === 43) break;
      if (deco[r][c] !== -1) break;
      deco[r][c] = 43;

      const tx = target.c - c;
      const ty = target.r - r;
      if (tx === 0 && ty === 0) break;
      if (Math.abs(tx) > Math.abs(ty)) c += Math.sign(tx);
      else if (ty !== 0) r += Math.sign(ty);
      else c += Math.sign(tx);
    }
  }

  return {
    doors,
    key: `world_${seed}`,
    cols: preset.cols,
    rows: preset.rows,
    tilesetKey: preset.tilesetKey,
    tilesetCols: preset.tilesetCols,
    groundLayer: ground,
    decoLayer: deco,
    walkableGround: preset.walkableGround,
    solidDeco: preset.solidDeco,
    flatDeco: preset.flatDeco,
    spawnPoint: preset.spawn,
  };
}
