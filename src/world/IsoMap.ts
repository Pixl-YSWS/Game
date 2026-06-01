import Phaser from "phaser";
import { cartToIso, TILE_W, TILE_H } from "../utils/IsoUtils";
import type { MapDef, MapObject } from "../types/map";
import { TILE_SRC, SOLID, PATH, GRASS, GRASS_DARK, WATER, TS, sandFrame, SAND_FRINGE } from "./tileset";

const SRC_TILE = 16;

export class IsoMap {
  private scene: Phaser.Scene;
  private mapDef: MapDef;
  // Stamped tile/object images, kept so the whole layer can be wiped when the
  // player switches to a different world.
  private stamps: Phaser.GameObjects.Image[] = [];
  // Looping animation timers for animated objects (farm animals), cleared on
  // destroy so a world switch doesn't leave them firing on dead images.
  private animTimers: Phaser.Time.TimerEvent[] = [];

  public boundsX = 0;
  public boundsY = 0;
  public boundsW = 0;
  public boundsH = 0;

  constructor(scene: Phaser.Scene, mapDef: MapDef) {
    this.scene = scene;
    this.mapDef = mapDef;
  }

  destroy() {
    for (const t of this.animTimers) t.remove(false);
    this.animTimers.length = 0;
    for (const img of this.stamps) img.destroy();
    this.stamps.length = 0;
  }

  build() {
    const { cols, rows, cozy } = this.mapDef;
    if (cozy) this.buildCozy();
    else this.buildLegacy();

    this.boundsX = 0;
    this.boundsY = 0;
    this.boundsW = cols * TILE_W;
    this.boundsH = rows * TILE_H;
  }

  // ── Cozy maps: tiles resolved via the CozyValley registry + objects ──────
  private buildCozy() {
    const { cols, rows, groundLayer, decoLayer, flatDeco, objects } = this.mapDef;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const { x, y } = cartToIso(col, row);

        const g = groundLayer[row]?.[col] ?? -1;
        // Paths/shore are sand drawn over grass; plain grass cells that touch
        // sand grow tuft overlays so the sand edge looks hand-drawn.
        if (g === PATH) {
          this.stampTile(GRASS, x, y, 0);
          const f = sandFrame(this.waterBits(col, row));
          this.stampSub(TS.beach, f.sx, f.sy, 16, 16, x, y, 0.2);
        } else if (g >= 0) {
          this.stampTile(g, x, y, 0);
          if (g === GRASS || g === GRASS_DARK) this.stampSandTufts(col, row, x, y);
        }

        const d = decoLayer[row]?.[col] ?? -1;
        // SOLID is collision-only (an object's footprint / a border) — no art.
        if (d >= 0 && d !== SOLID) {
          const depth = flatDeco.has(d) ? 0.5 : row + 1;
          this.stampTile(d, x, y, depth);
        }
      }
    }
    for (const obj of objects ?? []) this.stampObject(obj);
  }

  private isPath(c: number, r: number): boolean {
    return this.mapDef.groundLayer[r]?.[c] === PATH;
  }
  // Which orthogonal neighbours are open water (N=1,E=2,S=4,W=8).
  private waterBits(c: number, r: number): number {
    const w = (cc: number, rr: number) => (this.mapDef.groundLayer[rr]?.[cc] === WATER ? 1 : 0);
    return w(c, r - 1) | (w(c + 1, r) << 1) | (w(c, r + 1) << 2) | (w(c - 1, r) << 3);
  }
  // Overlay sand tufts on a grass cell for each orthogonal side touching sand.
  private stampSandTufts(c: number, r: number, wx: number, wy: number) {
    const pick = (arr: { sx: number; sy: number }[]) => arr[(c * 7 + r * 13) % arr.length];
    const sides: ["N" | "E" | "S" | "W", boolean][] = [
      ["N", this.isPath(c, r - 1)],
      ["E", this.isPath(c + 1, r)],
      ["S", this.isPath(c, r + 1)],
      ["W", this.isPath(c - 1, r)],
    ];
    for (const [dir, touching] of sides) {
      if (!touching) continue;
      const f = pick(SAND_FRINGE[dir]);
      this.stampSub(TS.beach, f.sx, f.sy, 16, 16, wx, wy, 0.3);
    }
  }

  // Resolve a cozy tile id to its sheet sub-rect and stamp one 16×16 cell.
  private stampTile(id: number, wx: number, wy: number, depth: number) {
    const src = TILE_SRC[id];
    if (!src) return;
    this.stampSub(src.key, src.fx * SRC_TILE, src.fy * SRC_TILE, SRC_TILE, SRC_TILE, wx, wy, depth);
  }

  // Stamp an arbitrary sub-rect of a sheet as one cell-sized image at `depth`.
  private stampSub(key: string, sx: number, sy: number, w: number, h: number, wx: number, wy: number, depth: number) {
    const frameKey = `${key}_r${sx}_${sy}_${w}_${h}`;
    const texture = this.scene.textures.get(key);
    if (!texture.has(frameKey)) texture.add(frameKey, 0, sx, sy, w, h);
    const img = this.scene.add.image(wx, wy, key, frameKey).setOrigin(0, 0);
    img.setScale(TILE_W / SRC_TILE, TILE_H / SRC_TILE);
    img.setDepth(depth);
    this.stamps.push(img);
  }

  // Stamp a free-standing multi-tile object (tree, house, animal). Depth is its
  // base row so players sort in front when below it and behind when above. If
  // the object declares animation frames, cycle them on a looping timer.
  private stampObject(obj: MapObject) {
    const { x, y } = cartToIso(obj.cx, obj.cy);
    const texture = this.scene.textures.get(obj.key);
    const register = (sx: number, sy: number) => {
      const fk = `${obj.key}_o${sx}_${sy}_${obj.w}_${obj.h}`;
      if (!texture.has(fk)) texture.add(fk, 0, sx, sy, obj.w, obj.h);
      return fk;
    };
    const img = this.scene.add.image(x, y, obj.key, register(obj.sx, obj.sy)).setOrigin(0, 0);
    img.setScale(TILE_W / SRC_TILE, TILE_H / SRC_TILE);
    // Flat decals sit just above the ground (player walks over); tall objects
    // depth-sort by their base row.
    img.setDepth(obj.flat ? 0.4 : obj.cy + obj.h / SRC_TILE);
    this.stamps.push(img);

    if (obj.frames && obj.frames.length > 1 && obj.fps) {
      const keys = obj.frames.map((f) => register(f.sx, f.sy));
      let i = 0;
      this.animTimers.push(
        this.scene.time.addEvent({
          delay: 1000 / obj.fps,
          loop: true,
          callback: () => {
            i = (i + 1) % keys.length;
            img.setFrame(keys[i]);
          },
        }),
      );
    }
  }

  // ── Legacy maps (house interiors): single packed tileset by index ────────
  private buildLegacy() {
    const { cols, rows, tilesetKey, tilesetCols, groundLayer, decoLayer, flatDeco } = this.mapDef;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const { x, y } = cartToIso(col, row);

        const gIdx = groundLayer[row]?.[col] ?? -1;
        if (gIdx >= 0) this.stampLegacy(tilesetKey, gIdx, tilesetCols, x, y, 0);

        const dIdx = decoLayer[row]?.[col] ?? -1;
        if (dIdx >= 0) {
          const depth = flatDeco.has(dIdx) ? 0.5 : row + 1;
          this.stampLegacy(tilesetKey, dIdx, tilesetCols, x, y, depth);
        }
      }
    }
  }

  private stampLegacy(
    textureKey: string,
    tileIndex: number,
    sheetCols: number,
    wx: number,
    wy: number,
    depth: number,
  ) {
    const srcCol = tileIndex % sheetCols;
    const srcRow = Math.floor(tileIndex / sheetCols);
    const frameKey = `${textureKey}_f${tileIndex}`;

    const texture = this.scene.textures.get(textureKey);
    if (!texture.has(frameKey)) {
      texture.add(frameKey, 0, srcCol * SRC_TILE, srcRow * SRC_TILE, SRC_TILE, SRC_TILE);
    }

    const img = this.scene.add.image(wx, wy, textureKey, frameKey);
    img.setScale(TILE_W / SRC_TILE, TILE_H / SRC_TILE);
    img.setOrigin(0, 0);
    img.setDepth(depth);
    this.stamps.push(img);
  }

  get centre(): { x: number; y: number } {
    return { x: this.boundsW / 2, y: this.boundsH / 2 };
  }
}
