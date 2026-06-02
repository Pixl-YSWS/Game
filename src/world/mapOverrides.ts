// Shared map-edit logic used by BOTH the client (live preview / rendering)
// and the server (validation + authoritative map state). Keep this Phaser-free
// so the server can import it directly.

import type { MapDef, NpcDef } from "../types/map";
import type { MapEdit, NpcEdit, MapRevision } from "../types/network";
import {
  GRASS,
  GRASS_DARK,
  PATH,
  WATER,
  SOLID,
  FLOWER_A,
  FLOWER_B,
  FLOWER_C,
  FLOWER_D,
  ROCK_A,
  ROCK_B,
} from "./tileset";

export type EditLayer = "ground" | "deco";

// Tiles an admin is allowed to paint. The server validates against these so a
// malicious client can't smuggle arbitrary tile ids into the shared world.
export const EDITABLE_GROUND_TILES: readonly number[] = [
  GRASS,
  GRASS_DARK,
  PATH,
  WATER,
];

// -1 is the "erase" value for the deco layer (clears flowers/rocks/walls).
export const EDITABLE_DECO_TILES: readonly number[] = [
  -1,
  FLOWER_A,
  FLOWER_B,
  FLOWER_C,
  FLOWER_D,
  ROCK_A,
  ROCK_B,
  SOLID,
];

export function editKey(layer: EditLayer, cx: number, cy: number): string {
  return `${layer}:${cx},${cy}`;
}

export function isValidEdit(
  edit: MapEdit,
  cols: number,
  rows: number,
): boolean {
  if (edit.layer !== "ground" && edit.layer !== "deco") return false;
  if (!Number.isInteger(edit.cx) || !Number.isInteger(edit.cy)) return false;
  if (edit.cx < 0 || edit.cy < 0 || edit.cx >= cols || edit.cy >= rows)
    return false;
  if (!Number.isInteger(edit.tile)) return false;
  const allowed =
    edit.layer === "ground" ? EDITABLE_GROUND_TILES : EDITABLE_DECO_TILES;
  return allowed.includes(edit.tile);
}

// Collapse an ordered list of revisions into the effective set of tile edits,
// with later revisions winning per cell. Inactive revisions are skipped.
export function foldRevisions(revisions: MapRevision[]): MapEdit[] {
  const merged = new Map<string, MapEdit>();
  for (const rev of revisions) {
    if (!rev.active) continue;
    for (const edit of rev.tiles) {
      merged.set(editKey(edit.layer, edit.cx, edit.cy), edit);
    }
  }
  return [...merged.values()];
}

// NPC edits can't be folded per-cell (add/move/remove interact), so we keep the
// full ordered list of active edits and replay it over the base NPC list.
export function concatNpcEdits(revisions: MapRevision[]): NpcEdit[] {
  const out: NpcEdit[] = [];
  for (const rev of revisions) {
    if (!rev.active) continue;
    for (const e of rev.npcs) out.push(e);
  }
  return out;
}

export function isValidNpcEdit(
  e: NpcEdit,
  cols: number,
  rows: number,
): boolean {
  if (e.op !== "add" && e.op !== "move" && e.op !== "remove") return false;
  if (typeof e.id !== "string" || !e.id || e.id.length > 64) return false;
  if (e.op === "remove") return true;
  if (!Number.isInteger(e.cx) || !Number.isInteger(e.cy)) return false;
  if (e.cx < 0 || e.cy < 0 || e.cx >= cols || e.cy >= rows) return false;
  if (e.name !== undefined && (typeof e.name !== "string" || e.name.length > 24))
    return false;
  if (e.dialogue !== undefined) {
    if (!Array.isArray(e.dialogue) || e.dialogue.length > 8) return false;
    if (e.dialogue.some((d) => typeof d !== "string" || d.length > 200))
      return false;
  }
  return true;
}

// Replay NPC edits over the base list, returning the effective NPC array.
export function applyNpcEdits(base: NpcDef[], edits: NpcEdit[]): NpcDef[] {
  const map = new Map<string, NpcDef>();
  for (const n of base) map.set(n.id, { ...n });
  for (const e of edits) {
    if (e.op === "remove") {
      map.delete(e.id);
    } else if (e.op === "add") {
      map.set(e.id, {
        id: e.id,
        name: e.name?.trim() || "Villager",
        sprite: 0,
        dialogue:
          e.dialogue && e.dialogue.length > 0
            ? e.dialogue
            : ["Hello there, traveller!"],
        cx: e.cx,
        cy: e.cy,
      });
    } else {
      const cur = map.get(e.id);
      if (cur) {
        cur.cx = e.cx;
        cur.cy = e.cy;
      }
    }
  }
  return [...map.values()];
}

// Mutates the given map's layers in place. Safe to call with out-of-bounds
// edits (they're ignored).
export function applyMapOverrides(map: MapDef, edits: MapEdit[]): void {
  for (const e of edits) {
    if (e.cy < 0 || e.cy >= map.rows || e.cx < 0 || e.cx >= map.cols) continue;
    if (e.layer === "ground") {
      const row = map.groundLayer[e.cy];
      if (row) row[e.cx] = e.tile;
    } else {
      const row = map.decoLayer[e.cy];
      if (row) row[e.cx] = e.tile;
    }
  }
}
