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

/**
 * A hand-authored Tiled map carries its own multi-tileset GID layers, which the
 * baked render path stamps directly (resolving each GID against `tilesets`).
 * This sits alongside the logical `groundLayer`/`decoLayer`/collision sets that
 * the game's movement + animal logic still drives off.
 */
export interface BakedTileset {
  // Phaser texture key the tileset image is loaded under.
  key: string;
  // GID of this tileset's first tile within the map (Tiled `firstgid`).
  firstgid: number;
  // Tiles per row in the source image.
  columns: number;
  // Total tiles in the tileset (so GID lookup can pick the right tileset).
  count: number;
}

export interface BakedLayer {
  name: string;
  // Flat row-major GID array (0 = empty), length cols*rows.
  data: number[];
  // Flat layers (water/ground/path) stamp at a constant depth; otherwise depth
  // sorts per row (row + 1) like deco objects so the player walks behind them.
  perRow: boolean;
  depth: number;
  // Water layers cycle their tiles through 4 horizontal frames.
  animateWater?: boolean;
}

export interface BakedRender {
  tileSize: number;
  tilesets: BakedTileset[];
  layers: BakedLayer[];
}

export interface MapDef {
  key: string;
  cols: number;
  rows: number;
  tilesetKey: string;
  tilesetCols: number;
  groundLayer: number[][];
  decoLayer: number[][];

  // Present on hand-authored Tiled maps; when set, IsoMap uses the baked path.
  baked?: BakedRender;

  // Disables the swim mechanic — players can't walk onto WATER tiles here.
  noSwim?: boolean;

  cozy?: boolean;
  objects?: MapObject[];
  walkableGround: ReadonlySet<number>;
  solidDeco: ReadonlySet<number>;

  flatDeco: ReadonlySet<number>;
  spawnPoint: { cx: number; cy: number };

  doors: Array<{ cx: number; cy: number }>;

  portal?: { cx: number; cy: number };

  // "col,row" keys of tiles a bridge is drawn over. Sharks may swim *under*
  // these (and render below the bridge) even though players walk on top.
  bridgeTiles?: ReadonlySet<string>;

  npcs: NpcDef[];
}
