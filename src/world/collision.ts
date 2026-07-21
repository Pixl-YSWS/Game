// Pixel-level collision for free (non-tile-stepped) player movement.
// Solid cells contribute AABBs: art-tight rects where the baked tilesets
// provide them (posts, trunks, wall edges), whole tiles otherwise. Phaser-free.

import type { MapDef } from "../types/map";
import { WATER } from "./tileset";
import { TILE_W, TILE_H } from "../utils/IsoUtils";

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const GID_MASK = 0x1fffffff;
const FLIP_H = 0x80000000;
const FLIP_V = 0x40000000;

export class CollisionMap {
  private map: MapDef;
  // Lazily-built per-cell blockers; undefined = not built yet, null = open.
  private cells: (Rect[] | null | undefined)[];

  constructor(map: MapDef) {
    this.map = map;
    this.cells = new Array(map.cols * map.rows);
  }

  /** Whether a tile blocks at all (legacy per-tile query, used by vaulting). */
  isBlocked(c: number, r: number): boolean {
    return this.rectsAt(c, r) !== null;
  }

  private rectsAt(c: number, r: number): Rect[] | null {
    const { cols, rows } = this.map;
    if (c < 0 || r < 0 || c >= cols || r >= rows)
      return [
        {
          x0: c * TILE_W,
          y0: r * TILE_H,
          x1: (c + 1) * TILE_W,
          y1: (r + 1) * TILE_H,
        },
      ];
    const i = r * cols + c;
    let rects = this.cells[i];
    if (rects === undefined) {
      rects = this.buildCell(c, r);
      this.cells[i] = rects;
    }
    return rects;
  }

  private buildCell(c: number, r: number): Rect[] | null {
    const m = this.map;
    const full: Rect = {
      x0: c * TILE_W,
      y0: r * TILE_H,
      x1: (c + 1) * TILE_W,
      y1: (r + 1) * TILE_H,
    };
    const g = m.groundLayer[r]?.[c];
    const canSwim = g === WATER && !m.noSwim;
    if (g === undefined || (!m.walkableGround.has(g) && !canSwim))
      return [full];
    const d = m.decoLayer[r]?.[c];
    if (d === undefined || d < 0 || !m.solidDeco.has(d)) return null;
    return this.artRects(c, r) ?? [full];
  }

  // Art-tight rects for a solid cell of a baked map: union of the hitboxes of
  // the object tiles stamped there. null → no art metadata, use the full tile.
  private artRects(c: number, r: number): Rect[] | null {
    const baked = this.map.baked;
    if (!baked) return null;
    const i = r * this.map.cols + c;
    const out: Rect[] = [];
    let found = false;
    for (const l of baked.layers) {
      if (!l.perRow) continue;
      const raw = l.data[i];
      if (!raw) continue;
      const gid = raw & GID_MASK;
      let best: (typeof baked.tilesets)[number] | undefined;
      for (const t of baked.tilesets)
        if (gid >= t.firstgid && gid < t.firstgid + t.count)
          if (!best || t.firstgid > best.firstgid) best = t;
      if (!best || best.flat) continue;
      found = true;
      const rec = best.solidRects?.[String(gid - best.firstgid)];
      if (!rec) return null; // untight art on this cell → whole tile blocks
      let [x0, y0, x1, y1] = rec;
      if (raw & FLIP_H) [x0, x1] = [TILE_W - x1, TILE_W - x0];
      if (raw & FLIP_V) [y0, y1] = [TILE_H - y1, TILE_H - y0];
      out.push({
        x0: c * TILE_W + x0,
        y0: r * TILE_H + y0,
        x1: c * TILE_W + x1,
        y1: r * TILE_H + y1,
      });
    }
    return found && out.length > 0 ? out : null;
  }

  /**
   * Move an AABB (centre cx/cy, half-extents hw/hh) by (dx, dy) with
   * axis-separated clamping — sliding along walls comes for free. Returns the
   * new centre.
   */
  moveBox(
    cx: number,
    cy: number,
    hw: number,
    hh: number,
    dx: number,
    dy: number,
  ): { x: number; y: number } {
    let x = cx;
    let y = cy;

    if (dx !== 0) {
      let nx = x + dx;
      const c0 = Math.floor((Math.min(x, nx) - hw) / TILE_W);
      const c1 = Math.floor((Math.max(x, nx) + hw) / TILE_W);
      const r0 = Math.floor((y - hh) / TILE_H);
      const r1 = Math.floor((y + hh) / TILE_H);
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) {
          const rects = this.rectsAt(c, r);
          if (!rects) continue;
          for (const rc of rects) {
            if (rc.y0 >= y + hh || rc.y1 <= y - hh) continue;
            if (dx > 0 && x + hw <= rc.x0 && nx + hw > rc.x0)
              nx = rc.x0 - hw;
            else if (dx < 0 && x - hw >= rc.x1 && nx - hw < rc.x1)
              nx = rc.x1 + hw;
          }
        }
      x = nx;
    }

    if (dy !== 0) {
      let ny = y + dy;
      const r0 = Math.floor((Math.min(y, ny) - hh) / TILE_H);
      const r1 = Math.floor((Math.max(y, ny) + hh) / TILE_H);
      const c0 = Math.floor((x - hw) / TILE_W);
      const c1 = Math.floor((x + hw) / TILE_W);
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) {
          const rects = this.rectsAt(c, r);
          if (!rects) continue;
          for (const rc of rects) {
            if (rc.x0 >= x + hw || rc.x1 <= x - hw) continue;
            if (dy > 0 && y + hh <= rc.y0 && ny + hh > rc.y0)
              ny = rc.y0 - hh;
            else if (dy < 0 && y - hh >= rc.y1 && ny - hh < rc.y1)
              ny = rc.y1 + hh;
          }
        }
      y = ny;
    }

    return { x, y };
  }
}
