import Phaser from "phaser";
import { cartToIso, TILE_W, TILE_H } from "../utils/IsoUtils";
import {
  GROUND_LAYER,
  DECO_LAYER,
  MAP_COLS,
  MAP_ROWS,
  SHEET_COLS_TOWN,
} from "../data/MapData";

/**
 * TileMap — top-down orthographic renderer.
 *
 * Source tiles : 16×16 px (kenney_tiny-town, 11 cols wide)
 * Rendered size: 16×16 px per tile (camera zoom handles scaling)
 *
 * Layers (bottom → top):
 *   GROUND  depth = 0          — terrain, roads, paving
 *   DECO    depth = row + 1    — buildings, trees, props (sorted by row)
 *   Player  depth = row + 1    — same depth band, sorts with deco
 */

const SRC_TILE = 16;

export class IsoMap {
  private scene: Phaser.Scene;

  public boundsX = 0;
  public boundsY = 0;
  public boundsW = 0;
  public boundsH = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  build() {
    for (let row = 0; row < MAP_ROWS; row++) {
      for (let col = 0; col < MAP_COLS; col++) {
        const { x, y } = cartToIso(col, row);

        // ── Ground layer — always below everything ───────────────────
        const gIdx = GROUND_LAYER[row]?.[col] ?? -1;
        if (gIdx >= 0) {
          this.stamp("tiles-town", gIdx, SHEET_COLS_TOWN, x, y, 0);
        }

        // ── Deco layer — depth sorted by row so south objects overlap north
        const dIdx = DECO_LAYER[row]?.[col] ?? -1;
        if (dIdx >= 0) {
          this.stamp("tiles-town", dIdx, SHEET_COLS_TOWN, x, y, row + 1);
        }
      }
    }

    this.boundsX = 0;
    this.boundsY = 0;
    this.boundsW = MAP_COLS * TILE_W;
    this.boundsH = MAP_ROWS * TILE_H;
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
    // Scale = 1 since source and render size both 16px; camera zoom does the rest
    img.setScale(TILE_W / SRC_TILE, TILE_H / SRC_TILE);
    img.setOrigin(0, 0); // top-left corner for square tiles
    img.setDepth(depth);
    return img;
  }

  get centre(): { x: number; y: number } {
    return {
      x: this.boundsW / 2,
      y: this.boundsH / 2,
    };
  }
}
