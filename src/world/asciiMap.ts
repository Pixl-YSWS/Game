// Human-editable ASCII grids for the hand-maintained map layers, replacing
// the old raw number[][] blobs. One character per tile; rows are lines.
// Phaser-free (the server imports map data too).

import { GRASS, GRASS_DARK, PATH, WATER, SOLID } from "./tileset";

export type Legend = Readonly<Record<string, number>>;

// Ground: what the tile *is* (drives walkability / swimming).
//   ~ water   . grass   , dark grass   : path
export const GROUND_LEGEND: Legend = {
  "~": WATER,
  ".": GRASS,
  ",": GRASS_DARK,
  ":": PATH,
};

// Deco/collision: whether the tile is blocked.
//   . open   # solid
export const DECO_LEGEND: Legend = {
  ".": -1,
  "#": SOLID,
};

/**
 * Parse a template-literal grid into a number[][] layer. Blank lines and
 * per-line indentation are ignored, so the grid can sit indented inside the
 * data file. Every row must be the same width; unknown characters throw at
 * module load (fail fast — a typo would otherwise corrupt collision).
 */
export function parseGrid(legend: Legend, text: string): number[][] {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const rows: number[][] = [];
  for (const line of lines) {
    const row: number[] = [];
    for (const ch of line) {
      const v = legend[ch];
      if (v === undefined)
        throw new Error(`asciiMap: unknown tile character "${ch}" in row ${rows.length}`);
      row.push(v);
    }
    if (rows.length > 0 && row.length !== rows[0].length)
      throw new Error(
        `asciiMap: row ${rows.length} is ${row.length} wide, expected ${rows[0].length}`,
      );
    rows.push(row);
  }
  return rows;
}

/** Inverse of parseGrid — used by tooling/tests to print a layer. */
export function formatGrid(legend: Legend, layer: number[][]): string {
  const inv = new Map<number, string>();
  for (const [ch, v] of Object.entries(legend)) inv.set(v, ch);
  return layer
    .map((row) => row.map((v) => inv.get(v) ?? "?").join(""))
    .join("\n");
}
