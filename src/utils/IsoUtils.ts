/**
 * TileUtils — top-down (orthographic) projection.
 *
 * Each tile is a square rendered at TILE_SIZE × TILE_SIZE pixels.
 * Kenney source tiles are 16×16; we render them at 16px (zoom handled by camera).
 *
 * Functions keep the same names (cartToIso / isoToCart) so no other
 * file needs to change — they just do square math now instead of diamond math.
 */

export const TILE_W = 16; // tile width in world pixels
export const TILE_H = 16; // tile height in world pixels (square for top-down)

/** Tile (col, row) → world pixel (top-left corner of the tile) */
export function cartToIso(cx: number, cy: number): { x: number; y: number } {
  return {
    x: cx * TILE_W,
    y: cy * TILE_H,
  };
}

/** World pixel → nearest tile */
export function isoToCart(wx: number, wy: number): { cx: number; cy: number } {
  return {
    cx: Math.floor(wx / TILE_W),
    cy: Math.floor(wy / TILE_H),
  };
}

/**
 * Depth for top-down: row index is enough.
 * Higher row = drawn on top (south = in front).
 */
export function isoDepth(cx: number, cy: number): number {
  return cy;
}
