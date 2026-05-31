import Phaser from "phaser";
import { cartToIso, TILE_W, TILE_H } from "../utils/IsoUtils";
import type { MapDef, MapObject } from "../types/map";
import { TILE_SRC, SOLID } from "./tileset";

const SRC_TILE = 16;

export class IsoMap {
  private scene: Phaser.Scene;
  private mapDef: MapDef;
  // Stamped tile/object images, kept so the whole layer can be wiped when the
  // player switches to a different world.
  private stamps: Phaser.GameObjects.Image[] = [];

  public boundsX = 0;
  public boundsY = 0;
  public boundsW = 0;
  public boundsH = 0;

  constructor(scene: Phaser.Scene, mapDef: MapDef) {
    this.scene = scene;
    this.mapDef = mapDef;
  }

  destroy() {
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
        if (g >= 0) this.stampTile(g, x, y, 0);

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

  // Resolve a cozy tile id to its sheet sub-rect and stamp one 16×16 cell.
  private stampTile(id: number, wx: number, wy: number, depth: number) {
    const src = TILE_SRC[id];
    if (!src) return;
    const frameKey = `${src.key}_t${id}`;
    const texture = this.scene.textures.get(src.key);
    if (!texture.has(frameKey)) {
      texture.add(frameKey, 0, src.fx * SRC_TILE, src.fy * SRC_TILE, SRC_TILE, SRC_TILE);
    }
    const img = this.scene.add.image(wx, wy, src.key, frameKey).setOrigin(0, 0);
    img.setScale(TILE_W / SRC_TILE, TILE_H / SRC_TILE);
    img.setDepth(depth);
    this.stamps.push(img);
  }

  // Stamp a free-standing multi-tile object (tree, house). Depth is its base
  // row so players sort in front when below it and behind when above.
  private stampObject(obj: MapObject) {
    const { x, y } = cartToIso(obj.cx, obj.cy);
    const frameKey = `${obj.key}_o${obj.sx}_${obj.sy}_${obj.w}_${obj.h}`;
    const texture = this.scene.textures.get(obj.key);
    if (!texture.has(frameKey)) {
      texture.add(frameKey, 0, obj.sx, obj.sy, obj.w, obj.h);
    }
    const img = this.scene.add.image(x, y, obj.key, frameKey).setOrigin(0, 0);
    img.setScale(TILE_W / SRC_TILE, TILE_H / SRC_TILE);
    img.setDepth(obj.cy + obj.h / SRC_TILE);
    this.stamps.push(img);
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
