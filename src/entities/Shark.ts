import Phaser from "phaser";
import { cartToIso, TILE_W, TILE_H } from "../utils/IsoUtils";
import type { MapObject, MapDef } from "../types/map";
import { TS, WATER } from "../world/tileset";

const SRC_TILE = 16;

export class Shark extends Phaser.GameObjects.Container {
  public cx: number;
  public cy: number;
  private sprite: Phaser.GameObjects.Image;
  private obj: MapObject;
  private mapDef: MapDef;
  private isMoving = false;
  private animTimer?: Phaser.Time.TimerEvent;
  private wanderTimer?: Phaser.Time.TimerEvent;
  private moveTween?: Phaser.Tweens.Tween;
  private bobTween?: Phaser.Tweens.Tween;
  private animKeys: string[];
  private animFps: number;

  static SHARK_KEYS: ReadonlySet<string> = new Set([TS.fish]);

  static isShark(key: string): boolean {
    return Shark.SHARK_KEYS.has(key);
  }

  constructor(scene: Phaser.Scene, obj: MapObject, mapDef: MapDef) {
    const { x, y } = cartToIso(obj.cx, obj.cy);
    super(scene, x, y);
    this.cx = obj.cx;
    this.cy = obj.cy;
    this.obj = obj;
    this.mapDef = mapDef;

    const texture = scene.textures.get(obj.key);
    const register = (sx: number, sy: number) => {
      const fk = `${obj.key}_sh${sx}_${sy}_${obj.w}_${obj.h}`;
      if (!texture.has(fk)) texture.add(fk, 0, sx, sy, obj.w, obj.h);
      return fk;
    };

    const frames = obj.frames && obj.frames.length > 0
      ? obj.frames
      : [{ sx: obj.sx, sy: obj.sy }];
    this.animKeys = frames.map((f) => register(f.sx, f.sy));
    this.animFps = obj.fps ?? 4;

    this.sprite = scene.add
      .image(0, 0, obj.key, this.animKeys[0])
      .setOrigin(0, 0);
    this.sprite.setScale(TILE_W / SRC_TILE, TILE_H / SRC_TILE);
    this.add(this.sprite);
    scene.add.existing(this);

    this.setDepth(obj.cy + obj.h / SRC_TILE);

    this.startSwimAnim();
    this.scheduleWander();
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

  private scheduleWander() {
    this.wanderTimer?.remove(false);
    this.wanderTimer = this.scene.time.addEvent({
      delay: 1500 + Math.random() * 2500,
      callback: () => this.wander(),
    });
  }

  private wander() {
    if (this.isMoving) return;

    const dirs: [number, number][] = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ];
    for (let i = dirs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
    }

    for (const [dx, dy] of dirs) {
      const nc = this.cx + dx;
      const nr = this.cy + dy;
      if (this.canMoveTo(nc, nr)) {
        this.swimTo(nc, nr, dx);
        return;
      }
    }

    this.scheduleWander();
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
        const g = this.mapDef.groundLayer[gr]?.[gc];
        if (g === undefined || g !== WATER) return false;
        const d = this.mapDef.decoLayer[gr]?.[gc];
        if (d !== undefined && d >= 0 && this.mapDef.solidDeco.has(d))
          return false;
      }
    }
    return true;
  }

  private swimTo(cx: number, cy: number, dx: number) {
    this.isMoving = true;
    this.cx = cx;
    this.cy = cy;

    if (dx > 0) this.sprite.setFlipX(true);
    else if (dx < 0) this.sprite.setFlipX(false);

    const dest = cartToIso(cx, cy);
    const dur = 600 + Math.random() * 300;

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
        this.setDepth(this.y / TILE_H + this.obj.h / SRC_TILE);
      },
      onComplete: () => {
        this.isMoving = false;
        this.sprite.y = 0;
        this.setDepth(this.cy + this.obj.h / SRC_TILE);
        this.scheduleWander();
      },
    });
  }

  destroy(fromScene?: boolean) {
    this.animTimer?.remove(false);
    this.wanderTimer?.remove(false);
    this.moveTween?.remove();
    this.bobTween?.remove();
    super.destroy(fromScene);
  }
}
