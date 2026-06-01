// BASIC UTILS FUNCTION

export const TILE_W = 16;
export const TILE_H = 16;

export function cartToIso(cx: number, cy: number): { x: number; y: number } {
  return {
    x: cx * TILE_W,
    y: cy * TILE_H,
  };
}

export function isoToCart(wx: number, wy: number): { cx: number; cy: number } {
  return {
    cx: Math.floor(wx / TILE_W),
    cy: Math.floor(wy / TILE_H),
  };
}

export function isoDepth(_cx: number, cy: number): number {
  return cy;
}
