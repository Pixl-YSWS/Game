import Phaser from "phaser";
import { cartToIso, TILE_W, TILE_H } from "../utils/IsoUtils";
import type { MapObject, MapDef } from "../types/map";
import { TS, WATER } from "../world/tileset";
import { FONT_CHAT } from "../ui/theme";
import { popHeart } from "./Animal";

const SRC_TILE = 16;

/** Every shark is, of course, a Blåhaj. */
export const SHARK_NAME = "Blåhaj";

const DECIDE_MOVE_MS = 90;
const DECIDE_IDLE_MS = 350;
const DECIDE_STUCK_MS = 700;
const SWIM_DUR_MIN = 280;
const SWIM_DUR_MAX = 380;

type PlayerPos = { cx: number; cy: number };

export class Shark extends Phaser.GameObjects.Container {
  public cx: number;
  public cy: number;
  private sprite: Phaser.GameObjects.Image;
  private nameTag!: Phaser.GameObjects.Text;
  private obj: MapObject;
  private mapDef: MapDef;
  private isMoving = false;
  private animTimer?: Phaser.Time.TimerEvent;
  private decideTimer?: Phaser.Time.TimerEvent;
  private moveTween?: Phaser.Tweens.Tween;
  private bobTween?: Phaser.Tweens.Tween;
  private happyTween?: Phaser.Tweens.Tween;
  private animKeys: string[];
  private animFps: number;
  private getPlayerPos: () => PlayerPos | null;

  static SHARK_KEYS: ReadonlySet<string> = new Set([TS.fish]);

  static isShark(key: string): boolean {
    return Shark.SHARK_KEYS.has(key);
  }

  constructor(
    scene: Phaser.Scene,
    obj: MapObject,
    mapDef: MapDef,
    getPlayerPos: () => PlayerPos | null,
  ) {
    const { x, y } = cartToIso(obj.cx, obj.cy);
    super(scene, x, y);
    this.cx = obj.cx;
    this.cy = obj.cy;
    this.obj = obj;
    this.mapDef = mapDef;
    this.getPlayerPos = getPlayerPos;

    const texture = scene.textures.get(obj.key);
    const register = (sx: number, sy: number) => {
      const fk = `${obj.key}_sh${sx}_${sy}_${obj.w}_${obj.h}`;
      if (!texture.has(fk)) texture.add(fk, 0, sx, sy, obj.w, obj.h);
      return fk;
    };

    const frames =
      obj.frames && obj.frames.length > 0
        ? obj.frames
        : [{ sx: obj.sx, sy: obj.sy }];
    this.animKeys = frames.map((f) => register(f.sx, f.sy));
    this.animFps = obj.fps ?? 4;

    this.sprite = scene.add
      .image(0, 0, obj.key, this.animKeys[0])
      .setOrigin(0, 0);
    this.sprite.setScale(TILE_W / SRC_TILE, TILE_H / SRC_TILE);
    this.add(this.sprite);

    const w = (obj.w / SRC_TILE) * TILE_W;
    this.nameTag = scene.add
      .text(w / 2, -3, SHARK_NAME, {
        fontSize: "16px",
        fontFamily: FONT_CHAT,
        color: "#bfe9ff",
        stroke: "#06324a",
        strokeThickness: 5,
      })
      .setOrigin(0.5, 1)
      .setResolution(4)
      .setScale(0.34);
    this.add(this.nameTag);

    scene.add.existing(this);

    this.setDepth(this.swimDepth(this.cy));

    this.startSwimAnim();
    this.scheduleDecide(400 + Math.random() * 300);
  }

  private startSwimAnim() {
    this.animTimer?.remove(false);
    if (this.animKeys.length > 1 && this.animFps > 0) {
      let i = 0;
      this.animTimer = this.scene.time.addEvent({
        delay: 1000 / this.animFps,
        loop: true,
        callback: () => {
          i = (i + 1) % this.animKeys.length;
          this.sprite.setFrame(this.animKeys[i]);
        },
      });
    }
  }

  private scheduleDecide(delay: number) {
    this.decideTimer?.remove(false);
    this.decideTimer = this.scene.time.addEvent({
      delay,
      callback: () => this.decide(),
    });
  }

  private decide() {
    if (this.isMoving) {
      this.scheduleDecide(DECIDE_MOVE_MS);
      return;
    }

    const player = this.getPlayerPos();
    if (!player) {
      this.scheduleDecide(500);
      return;
    }

    const target = this.findClosestWaterTileTo(player.cx, player.cy);
    if (!target) {
      this.scheduleDecide(DECIDE_STUCK_MS);
      return;
    }

    const dx = target.cx - this.cx;
    const dy = target.cy - this.cy;
    const dist = Math.abs(dx) + Math.abs(dy);

    if (dist === 0) {
      this.faceTowards(player.cx);
      this.startHappyWiggle();
      this.scheduleDecide(DECIDE_IDLE_MS + Math.random() * 250);
      return;
    }

    const step = this.pathStepToward(target.cx, target.cy);
    if (!step) {
      this.faceTowards(player.cx);
      this.scheduleDecide(DECIDE_STUCK_MS);
      return;
    }

    const [nc, nr] = step;
    this.swimTo(nc, nr, Math.sign(nc - this.cx));
    this.scheduleDecide(DECIDE_MOVE_MS);
  }

  private findClosestWaterTileTo(
    px: number,
    py: number,
  ): { cx: number; cy: number } | null {
    const cols = this.mapDef.cols;
    const rows = this.mapDef.rows;
    const maxR = Math.max(cols, rows);
    for (let radius = 0; radius <= maxR; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const c = px + dx;
          const r = py + dy;
          if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
          if (this.mapDef.groundLayer[r][c] === WATER) {
            return { cx: c, cy: r };
          }
        }
      }
    }
    return null;
  }

  private pathStepToward(
    targetCx: number,
    targetCy: number,
  ): [number, number] | null {
    const startKey = `${this.cx},${this.cy}`;
    const targetKey = `${targetCx},${targetCy}`;
    if (startKey === targetKey) return null;

    const visited = new Set<string>([startKey]);
    const queue: [number, number, [number, number][]][] = [
      [this.cx, this.cy, []],
    ];
    const dirs: [number, number][] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];

    while (queue.length > 0) {
      const [c, r, path] = queue.shift()!;
      for (const [dc, dr] of dirs) {
        const nc = c + dc;
        const nr = r + dr;
        if (!this.canMoveTo(nc, nr)) continue;
        const key = `${nc},${nr}`;
        if (visited.has(key)) continue;
        visited.add(key);
        const newPath: [number, number][] = [...path, [nc, nr]];
        if (key === targetKey) return newPath[0];
        queue.push([nc, nr, newPath]);
      }
    }
    return null;
  }

  private faceTowards(targetCx: number) {
    if (targetCx > this.cx) {
      this.sprite.setFlipX(false);
    } else if (targetCx < this.cx) {
      this.sprite.setFlipX(true);
    }
  }

  private startHappyWiggle() {
    this.stopHappyWiggle();
    this.happyTween = this.scene.tweens.add({
      targets: this.sprite,
      angle: { from: -8, to: 8 },
      duration: 220,
      yoyo: true,
      repeat: 2,
      ease: "Sine.easeInOut",
      onComplete: () => {
        this.sprite.angle = 0;
      },
    });
  }

  private stopHappyWiggle() {
    this.happyTween?.remove();
    this.happyTween = undefined;
    this.sprite.angle = 0;
  }

  /** World-space anchor (top-centre) for a floating prompt above Blåhaj. */
  getPetAnchor(): { x: number; y: number } {
    const w = (this.obj.w / SRC_TILE) * TILE_W;
    return { x: this.x + w / 2, y: this.y - 12 };
  }

  /** True if (px,py) is orthogonally adjacent to (or on) the shark's tiles. */
  isNear(px: number, py: number): boolean {
    const tw = Math.ceil(this.obj.w / SRC_TILE);
    const th = Math.ceil(this.obj.h / SRC_TILE);
    for (let r = 0; r < th; r++)
      for (let c = 0; c < tw; c++)
        if (Math.abs(this.cx + c - px) + Math.abs(this.cy + r - py) <= 1)
          return true;
    return false;
  }

  makeClickable(cursor: string, onClick: () => void): this {
    const w = (this.obj.w / SRC_TILE) * TILE_W;
    const h = (this.obj.h / SRC_TILE) * TILE_H;
    this.setSize(w, h);
    this.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(0, 0, w, h),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      cursor,
    });
    this.on("pointerdown", onClick);
    return this;
  }

  /** Blåhaj loves being petted: a floating heart + a happy wiggle. */
  pet() {
    const w = (this.obj.w / SRC_TILE) * TILE_W;
    popHeart(this.scene, this.x + w / 2, this.y - 4);
    this.startHappyWiggle();
  }

  private isBridge(cx: number, cy: number): boolean {
    return this.mapDef.bridgeTiles?.has(`${cx},${cy}`) ?? false;
  }

  private canMoveTo(cx: number, cy: number): boolean {
    const tw = Math.ceil(this.obj.w / SRC_TILE);
    const th = Math.ceil(this.obj.h / SRC_TILE);
    for (let r = 0; r < th; r++) {
      for (let c = 0; c < tw; c++) {
        const gc = cx + c;
        const gr = cy + r;
        if (gc < 0 || gr < 0 || gc >= this.mapDef.cols || gr >= this.mapDef.rows)
          return false;
        // A bridge tile is passable — the shark swims beneath it — regardless of
        // the paved ground / solid railing deco stamped there for players.
        if (this.isBridge(gc, gr)) continue;
        const g = this.mapDef.groundLayer[gr]?.[gc];
        if (g === undefined || g !== WATER) return false;
        const d = this.mapDef.decoLayer[gr]?.[gc];
        if (d !== undefined && d >= 0 && this.mapDef.solidDeco.has(d))
          return false;
      }
    }
    return true;
  }

  // Depth that keeps the shark below the bridge deck (bridge layers sit at
  // depth 0.2) when it's swimming under one, else its normal in-water depth.
  private swimDepth(cy: number): number {
    return this.isBridge(this.cx, cy) ? 0.15 : cy + this.obj.h / SRC_TILE;
  }

  private swimTo(cx: number, cy: number, dx: number) {
    this.isMoving = true;
    this.stopHappyWiggle();
    this.cx = cx;
    this.cy = cy;

    if (dx > 0) this.sprite.setFlipX(false);
    else if (dx < 0) this.sprite.setFlipX(true);

    const dest = cartToIso(cx, cy);
    const dur = SWIM_DUR_MIN + Math.random() * (SWIM_DUR_MAX - SWIM_DUR_MIN);

    this.bobTween = this.scene.tweens.add({
      targets: this.sprite,
      y: -2,
      duration: dur / 4,
      yoyo: true,
      repeat: 3,
      ease: "Sine.easeInOut",
    });

    this.moveTween = this.scene.tweens.add({
      targets: this,
      x: dest.x,
      y: dest.y,
      duration: dur,
      ease: "Sine.easeInOut",
      onUpdate: () => {
        this.setDepth(
          this.isBridge(this.cx, this.cy)
            ? 0.15
            : this.y / TILE_H + this.obj.h / SRC_TILE,
        );
      },
      onComplete: () => {
        this.isMoving = false;
        this.sprite.y = 0;
        this.setDepth(this.swimDepth(this.cy));
      },
    });
  }

  destroy(fromScene?: boolean) {
    this.animTimer?.remove(false);
    this.decideTimer?.remove(false);
    this.moveTween?.remove();
    this.bobTween?.remove();
    this.happyTween?.remove();
    super.destroy(fromScene);
  }
}
