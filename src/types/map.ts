export interface MapDef {
  key: string;
  cols: number;
  rows: number;
  tilesetKey: string;
  tilesetCols: number;
  groundLayer: number[][];
  decoLayer: number[][];
  walkableGround: ReadonlySet<number>;
  solidDeco: ReadonlySet<number>;
  // Decos that render at ground level (below the player). Everything else
  // is treated as a tall object and sorted by tile row.
  flatDeco: ReadonlySet<number>;
  spawnPoint: { cx: number; cy: number };
}
