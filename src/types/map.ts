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
}

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
  // Tile positions where walking triggers entering a house interior.
  doors: Array<{ cx: number; cy: number }>;
  // Tile where activating the portal switches worlds (open world ⇄ village).
  portal?: { cx: number; cy: number };
  // Static NPCs that live in this map.
  npcs: NpcDef[];
}
