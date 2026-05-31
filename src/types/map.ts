export interface NpcDef {
  // Stable id so future quest state can be keyed to a specific NPC even
  // across map regenerations.
  id: string;
  cx: number;
  cy: number;
  name: string;
  // Tile index in `tiles-battle` used for this NPC's sprite.
  sprite: number;
  // Lines spoken in order; the dialogue closes after the last one.
  dialogue: string[];
  // Optional one-shot pixel reward granted by the server the first time
  // this player talks to this NPC. Server-enforced — clients can't farm.
  reward?: number;
  // If set, talking to this NPC opens the shop instead of dialogue. Only
  // one shop catalog today, so the id is informational.
  shopId?: string;
  // If set, talking to this NPC opens a named panel scene instead of dialogue
  // (e.g. "projects" → the projects board).
  panel?: "projects";
}

// A free-standing multi-tile sprite (tree, house, …) placed on the cozy map by
// its top-left anchor tile. Rendered from a sub-rectangle of a texture; its
// collision footprint lives in the decoLayer as SOLID cells (so the server's
// numeric walkability check still works without knowing about objects).
export interface MapObject {
  key: string; // texture key
  sx: number;
  sy: number;
  w: number; // source rect, pixels
  h: number;
  cx: number; // anchor tile (top-left)
  cy: number;
}

export interface MapDef {
  key: string;
  cols: number;
  rows: number;
  tilesetKey: string;
  tilesetCols: number;
  groundLayer: number[][];
  decoLayer: number[][];
  // Cozy maps address tiles via the CozyValley tile registry (see
  // src/world/tileset.ts) and carry free-standing `objects`; legacy maps
  // (house interiors) slice a single `tilesetKey` by index instead.
  cozy?: boolean;
  objects?: MapObject[];
  walkableGround: ReadonlySet<number>;
  solidDeco: ReadonlySet<number>;
  // Decos that render at ground level (below the player). Everything else
  // is treated as a tall object and sorted by tile row.
  flatDeco: ReadonlySet<number>;
  spawnPoint: { cx: number; cy: number };
  // Tile positions where walking triggers entering a house interior.
  doors: Array<{ cx: number; cy: number }>;
  // Tile where activating the portal switches worlds (open world ⇄ village).
  portal?: { cx: number; cy: number };
  // Static NPCs that live in this map.
  npcs: NpcDef[];
}
