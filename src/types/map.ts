export interface NpcDef {
  id: string;
  cx: number;
  cy: number;
  name: string;

  sprite: number;

  dialogue: string[];

  reward?: number;

  shopId?: string;

  panel?: "projects";
}

export interface MapObject {
  key: string;
  sx: number;
  sy: number;
  w: number;
  h: number;
  cx: number;
  cy: number;

  frames?: { sx: number; sy: number }[];
  fps?: number;

  flat?: boolean;
}

export interface MapDef {
  key: string;
  cols: number;
  rows: number;
  tilesetKey: string;
  tilesetCols: number;
  groundLayer: number[][];
  decoLayer: number[][];

  cozy?: boolean;
  objects?: MapObject[];
  walkableGround: ReadonlySet<number>;
  solidDeco: ReadonlySet<number>;

  flatDeco: ReadonlySet<number>;
  spawnPoint: { cx: number; cy: number };

  doors: Array<{ cx: number; cy: number }>;

  portal?: { cx: number; cy: number };

  npcs: NpcDef[];
}
