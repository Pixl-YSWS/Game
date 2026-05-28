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
  spawnPoint: { cx: number; cy: number };
}
