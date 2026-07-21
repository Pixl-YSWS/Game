import Phaser from "phaser";
import { cartToIso, TILE_W, TILE_H } from "../utils/IsoUtils";
import type { MapDef, MapObject } from "../types/map";
import {
  TILE_SRC,
  SOLID,
  PATH,
  GRASS,
  GRASS_DARK,
  WATER,
  TS,
  sandFrame,
  SAND_FRINGE,
} from "./tileset";

const SRC_TILE = 16;

export class IsoMap {
  private scene: Phaser.Scene;
  private mapDef: MapDef;

  private stamps: Phaser.GameObjects.Image[] = [];

  private animTimers: Phaser.Time.TimerEvent[] = [];

  private waterStamps: { img: Phaser.GameObjects.Image; frames: string[] }[] = [];

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
    this.waterStamps.length = 0;
  }

  build() {
    const { cols, rows, cozy } = this.mapDef;
    if (this.mapDef.baked) this.buildBaked();
    else if (cozy) this.buildCozy();
    else this.buildLegacy();

    this.boundsX = 0;
    this.boundsY = 0;
    this.boundsW = cols * TILE_W;
    this.boundsH = rows * TILE_H;

    this.startWaterAnim();
  }

  private buildCozy() {
    const { cols, rows, groundLayer, decoLayer, flatDeco, objects } =
      this.mapDef;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const { x, y } = cartToIso(col, row);

        const g = groundLayer[row]?.[col] ?? -1;

        if (g === PATH) {
          this.stampTile(GRASS, x, y, 0);
          const f = sandFrame(this.waterBits(col, row));
          this.stampSub(TS.beach, f.sx, f.sy, 16, 16, x, y, 0.2);
        } else if (g === WATER) {
          this.stampWaterTile(x, y);
        } else if (g >= 0) {
          this.stampTile(g, x, y, 0);
          if (g === GRASS || g === GRASS_DARK)
            this.stampSandTufts(col, row, x, y);
        }

        const d = decoLayer[row]?.[col] ?? -1;

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

  private waterBits(c: number, r: number): number {
    const w = (cc: number, rr: number) =>
      this.mapDef.groundLayer[rr]?.[cc] === WATER ? 1 : 0;
    return (
      w(c, r - 1) | (w(c + 1, r) << 1) | (w(c, r + 1) << 2) | (w(c - 1, r) << 3)
    );
  }

  private stampSandTufts(c: number, r: number, wx: number, wy: number) {
    const pick = (arr: { sx: number; sy: number }[]) =>
      arr[(c * 7 + r * 13) % arr.length];
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

  private stampWaterTile(wx: number, wy: number, depth = 0) {
    const key = TS.water;
    const texture = this.scene.textures.get(key);
    const frames: string[] = [];
    for (let fx = 0; fx < 4; fx++) {
      const sx = fx * SRC_TILE;
      const fk = `${key}_wf${fx}`;
      if (!texture.has(fk)) texture.add(fk, 0, sx, 0, SRC_TILE, SRC_TILE);
      frames.push(fk);
    }
    const img = this.scene.add.image(wx, wy, key, frames[0]).setOrigin(0, 0);
    img.setScale(TILE_W / SRC_TILE, TILE_H / SRC_TILE);
    img.setDepth(depth);
    this.stamps.push(img);
    this.waterStamps.push({ img, frames });
  }

  private startWaterAnim() {
    if (this.waterStamps.length === 0) return;
    let i = 0;
    this.animTimers.push(
      this.scene.time.addEvent({
        delay: 250,
        loop: true,
        callback: () => {
          i = (i + 1) % 4;
          for (const ws of this.waterStamps) ws.img.setFrame(ws.frames[i]);
        },
      }),
    );
  }

  private stampTile(id: number, wx: number, wy: number, depth: number) {
    const src = TILE_SRC[id];
    if (!src) return;
    this.stampSub(
      src.key,
      src.fx * SRC_TILE,
      src.fy * SRC_TILE,
      SRC_TILE,
      SRC_TILE,
      wx,
      wy,
      depth,
    );
  }

  private stampSub(
    key: string,
    sx: number,
    sy: number,
    w: number,
    h: number,
    wx: number,
    wy: number,
    depth: number,
    flipX = false,
    flipY = false,
  ) {
    const frameKey = `${key}_r${sx}_${sy}_${w}_${h}`;
    const texture = this.scene.textures.get(key);
    if (!texture.has(frameKey)) texture.add(frameKey, 0, sx, sy, w, h);
    const img = this.scene.add.image(wx, wy, key, frameKey).setOrigin(0, 0);
    img.setScale(TILE_W / SRC_TILE, TILE_H / SRC_TILE);
    // flipX/flipY mirror the texture in place (origin is top-left), so the tile
    // still occupies the same cell.
    if (flipX) img.setFlipX(true);
    if (flipY) img.setFlipY(true);
    img.setDepth(depth);
    this.stamps.push(img);
  }

  private stampObject(obj: MapObject) {
    const { x, y } = cartToIso(obj.cx, obj.cy);
    const texture = this.scene.textures.get(obj.key);
    const register = (sx: number, sy: number) => {
      const fk = `${obj.key}_o${sx}_${sy}_${obj.w}_${obj.h}`;
      if (!texture.has(fk)) texture.add(fk, 0, sx, sy, obj.w, obj.h);
      return fk;
    };
    const img = this.scene.add
      .image(x, y, obj.key, register(obj.sx, obj.sy))
      .setOrigin(0, 0);
    img.setScale(TILE_W / SRC_TILE, TILE_H / SRC_TILE);

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

  // Hand-authored Tiled maps: stamp each layer's GIDs verbatim, resolving every
  // GID against the map's own multi-tileset table. Animals/trees were extracted
  // to `objects` by the sync script and stamp on top.
  private buildBaked() {
    const baked = this.mapDef.baked!;
    const { cols } = this.mapDef;
    const T = baked.tileSize;

    const resolve = (gid: number) => {
      let best: (typeof baked.tilesets)[number] | undefined;
      for (const t of baked.tilesets)
        if (gid >= t.firstgid && gid < t.firstgid + t.count)
          if (!best || t.firstgid > best.firstgid) best = t;
      if (!best) return null;
      const local = gid - best.firstgid;
      const localRow = Math.floor(local / best.columns);
      return {
        key: best.key,
        sx: (local % best.columns) * T,
        sy: localRow * T,
        flat: best.flat ?? false,
        // Rows between this tile and its sprite's base row (0 for the base
        // itself), or undefined when the tileset has no sprite grid metadata.
        baseOffset: best.spriteRows
          ? best.spriteRows - 1 - (localRow % best.spriteRows)
          : undefined,
      };
    };

    // Tiled stores horizontal/vertical/diagonal flips in the top 3 GID bits.
    const FLIP_H = 0x80000000;
    const FLIP_V = 0x40000000;
    const GID_MASK = 0x1fffffff;

    for (const layer of baked.layers) {
      const runBase = layer.perRow
        ? verticalRunBases(layer.data, cols)
        : undefined;
      for (let i = 0; i < layer.data.length; i++) {
        const raw = layer.data[i];
        if (!raw) continue;
        const flipX = (raw & FLIP_H) !== 0;
        const flipY = (raw & FLIP_V) !== 0;
        const gid = raw & GID_MASK;
        const col = i % cols;
        const row = (i / cols) | 0;
        const src = resolve(gid);
        if (!src) continue;
        const { x, y } = cartToIso(col, row);
        // Depth for object layers:
        //  - flat tilesets (grass patches / ground skirts) go under entities;
        //  - tall-sprite tiles sort by their sprite's base row, so the player
        //    goes behind/in front of the whole tree or house at once;
        //  - anything else (props, fences) sorts by the bottom of its vertical
        //    tile run — a stacked post/lamp sorts as one object, a fence line
        //    stays per-tile.
        const depth = !layer.perRow
          ? layer.depth
          : src.flat
            ? 0.45
            : src.baseOffset !== undefined
              ? row + src.baseOffset + 1
              : (runBase?.[i] ?? row) + 1;

        if (layer.animateWater) {
          this.stampBakedWater(src.key, src.sy, x, y, depth);
        } else {
          this.stampSub(src.key, src.sx, src.sy, T, T, x, y, depth, flipX, flipY);
        }
      }
    }

    this.stampPaintedCells();

    for (const obj of this.mapDef.objects ?? []) this.stampObject(obj);
  }

  // Editor overrides on a baked map: the GID layers above render the original
  // art, so repainted cells stamp their logical tile on top (ground above the
  // baked ground/path bands, deco per the usual cozy rules). SOLID stays
  // invisible, exactly like the cozy render path.
  private stampPaintedCells() {
    const painted = this.mapDef.painted;
    if (!painted || painted.size === 0) return;
    const { groundLayer, decoLayer, flatDeco } = this.mapDef;
    for (const key of painted) {
      const [layer, coords] = key.split(":");
      const [c, r] = coords.split(",").map(Number);
      if (!Number.isFinite(c) || !Number.isFinite(r)) continue;
      const { x, y } = cartToIso(c, r);
      if (layer === "ground") {
        const g = groundLayer[r]?.[c] ?? -1;
        if (g === WATER) this.stampWaterTile(x, y, 0.3);
        else if (g >= 0) this.stampTile(g, x, y, 0.3);
      } else {
        const d = decoLayer[r]?.[c] ?? -1;
        if (d >= 0 && d !== SOLID)
          this.stampTile(d, x, y, flatDeco.has(d) ? 0.5 : r + 1);
      }
    }
  }

  // A water tile shimmers through the four columns of its own row.
  private stampBakedWater(
    key: string,
    sy: number,
    wx: number,
    wy: number,
    depth: number,
  ) {
    const texture = this.scene.textures.get(key);
    const frames: string[] = [];
    for (let c = 0; c < 4; c++) {
      const sx = c * SRC_TILE;
      const fk = `${key}_bw${sx}_${sy}`;
      if (!texture.has(fk)) texture.add(fk, 0, sx, sy, SRC_TILE, SRC_TILE);
      frames.push(fk);
    }
    const img = this.scene.add.image(wx, wy, key, frames[0]).setOrigin(0, 0);
    img.setScale(TILE_W / SRC_TILE, TILE_H / SRC_TILE);
    img.setDepth(depth);
    this.stamps.push(img);
    this.waterStamps.push({ img, frames });
  }

  private buildLegacy() {
    const {
      cols,
      rows,
      tilesetKey,
      tilesetCols,
      groundLayer,
      decoLayer,
      flatDeco,
    } = this.mapDef;
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
      texture.add(
        frameKey,
        0,
        srcCol * SRC_TILE,
        srcRow * SRC_TILE,
        SRC_TILE,
        SRC_TILE,
      );
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

// For each non-empty cell of a flat row-major GID array: the bottom row of
// the contiguous vertical run of non-empty cells it belongs to. Single tiles
// map to their own row, a stacked column of tiles maps to the stack's base.
function verticalRunBases(data: readonly number[], cols: number): Int32Array {
  const rows = Math.ceil(data.length / cols);
  const bases = new Int32Array(data.length);
  for (let c = 0; c < cols; c++) {
    let r = 0;
    while (r < rows) {
      if (!data[r * cols + c]) {
        r++;
        continue;
      }
      let end = r;
      while (end + 1 < rows && data[(end + 1) * cols + c]) end++;
      for (let rr = r; rr <= end; rr++) bases[rr * cols + c] = end;
      r = end + 1;
    }
  }
  return bases;
}
