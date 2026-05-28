import Phaser from "phaser";
import { cartToIso, TILE_W, TILE_H } from "../utils/IsoUtils";
import type { MapDef } from "../types/map";

const SRC_TILE = 16;

export class IsoMap {
  private scene: Phaser.Scene;
  private mapDef: MapDef;

  public boundsX = 0;
  public boundsY = 0;
  public boundsW = 0;
  public boundsH = 0;

  constructor(scene: Phaser.Scene, mapDef: MapDef) {
    this.scene = scene;
    this.mapDef = mapDef;
  }

  build() {
    const { cols, rows, tilesetKey, tilesetCols, groundLayer, decoLayer } = this.mapDef;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const { x, y } = cartToIso(col, row);

        const gIdx = groundLayer[row]?.[col] ?? -1;
        if (gIdx >= 0) {
          this.stamp(tilesetKey, gIdx, tilesetCols, x, y, 0);
        }

        const dIdx = decoLayer[row]?.[col] ?? -1;
        if (dIdx >= 0) {
          this.stamp(tilesetKey, dIdx, tilesetCols, x, y, row + 1);
        }
      }
    }

    this.boundsX = 0;
    this.boundsY = 0;
    this.boundsW = cols * TILE_W;
    this.boundsH = rows * TILE_H;
  }

  private stamp(
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
    return img;
  }

  get centre(): { x: number; y: number } {
    return { x: this.boundsW / 2, y: this.boundsH / 2 };
  }
}
