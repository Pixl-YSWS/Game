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
  // For tilesets that are a grid of whole tall sprites (trees, houses, barns,
  // tents): how many tile rows one sprite spans. Lets the renderer Y-sort each
  // tile by its sprite's *base* row (the tile's local row modulo spriteRows
  // tells how far above the base it sits), so players sort against the whole
  // object instead of slicing through its middle. Omit for mixed prop sheets.
  spriteRows?: number;
  // Local tile ids whose art is physically present at ground level (trunk,
  // walls, tent fabric) — derived from the sprite pixels. Painted collision is
  // kept only on these tiles; canopy, roofs, transparent slope corners and
  // shadow skirts get their collision cleared so players are only blocked
  // where something visible stands. Omit to keep all painted collision.
  solidLocals?: number[];
  // Pixel-tight hitboxes per local tile id: [x0, y0, x1, y1] within the
  // 16×16 tile, the bounding box of the art's ground-level pixels. Solid
  // tiles without an entry block their whole tile. Lets free movement hug
  // posts/trunks instead of stopping at the tile edge.
  solidRects?: Record<string, number[]>;
  // Ground-decor tileset (grass patches, soil skirts): even when its tiles
  // appear in a per-row object layer they render flat, under every entity,
  // and never want collision.
  flat?: boolean;
}

export interface BakedLayer {
  name: string;
  // Flat row-major GID array (0 = empty), length cols*rows.
  data: number[];
  // Flat layers (water/ground/path) stamp at a constant depth; otherwise depth
  // sorts per row (row + 1) like deco objects so the player walks behind them.
  // Tiles from a tileset with `spriteRows` set additionally sort by their
  // sprite's base row rather than their own row.
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

  // Cells repainted by the in-game map editor ("layer:cx,cy" keys, matching
  // mapOverrides.editKey). Baked maps render their GID layers verbatim, so
  // IsoMap stamps these cells' groundLayer/decoLayer values on top — otherwise
  // admin edits to a baked map would change collision invisibly.
  painted?: ReadonlySet<string>;

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
