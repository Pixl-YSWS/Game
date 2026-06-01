import Phaser from "phaser";
import { cartToIso, TILE_W, TILE_H } from "../utils/IsoUtils";
import type { MapObject, MapDef } from "../types/map";
import { TS } from "../world/tileset";

const SRC_TILE = 16;

interface FrameDef {
  sx: number;
  sy: number;
}

function walkFrames(key: string): FrameDef[] {
  if (key === TS.cow) {
    const f = (col: number) => ({ sx: col * 32, sy: 96 });
    return [f(0), f(1), f(2), f(3)];
  }
  if (key === TS.chicken) {
    const f = (col: number) => ({ sx: col * 16, sy: 32 });
    return [f(0), f(1)];
  }
  return [];
}

export class Animal extends Phaser.GameObjects.Container {
  public cx: number;
  public cy: number;
  private sprite: Phaser.GameObjects.Image;
  private obj: MapObject;
  private mapDef: MapDef;
  private isMoving = false;
  private idleAnimKeys: string[] = [];
  private idleFps: number;
  private walkAnimKeys: string[] = [];
  private animIndex = 0;
  private animTimer?: Phaser.Time.TimerEvent;
  private wanderTimer?: Phaser.Time.TimerEvent;
  private moveTween?: Phaser.Tweens.Tween;
  private bobTween?: Phaser.Tweens.Tween;

  static ANIMAL_KEYS: ReadonlySet<string> = new Set([TS.cow, TS.chicken]);

  static isAnimal(key: string): boolean {
    return Animal.ANIMAL_KEYS.has(key);
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
      const fk = `${obj.key}_an${sx}_${sy}_${obj.w}_${obj.h}`;
      if (!texture.has(fk)) texture.add(fk, 0, sx, sy, obj.w, obj.h);
      return fk;
    };

    if (obj.frames && obj.frames.length > 0) {
      this.idleAnimKeys = obj.frames.map((f) => register(f.sx, f.sy));
    } else {
      this.idleAnimKeys = [register(obj.sx, obj.sy)];
    }
    this.idleFps = obj.fps ?? 3;

    this.walkAnimKeys = walkFrames(obj.key).map((f) => register(f.sx, f.sy));

    this.sprite = scene.add
      .image(0, 0, obj.key, this.idleAnimKeys[0])
      .setOrigin(0, 0);
    this.sprite.setScale(TILE_W / SRC_TILE, TILE_H / SRC_TILE);
    this.add(this.sprite);
    scene.add.existing(this);

    this.setDepth(obj.flat ? 0.4 : obj.cy + obj.h / SRC_TILE);

    this.playAnim(this.idleAnimKeys, this.idleFps);
    this.scheduleWander();
  }

  private playAnim(keys: string[], fps: number) {
    this.animTimer?.remove(false);
    this.animTimer = undefined;
    this.animIndex = 0;
    this.sprite.setFrame(keys[0]);
    if (keys.length > 1 && fps > 0) {
      this.animTimer = this.scene.time.addEvent({
        delay: 1000 / fps,
        loop: true,
        callback: () => {
          this.animIndex = (this.animIndex + 1) % keys.length;
          this.sprite.setFrame(keys[this.animIndex]);
        },
      });
    }
  }

  private scheduleWander() {
    this.wanderTimer = this.scene.time.addEvent({
      delay: 3000 + Math.random() * 5000,
      callback: () => this.wander(),
    });
  }

  private wander() {
    if (this.isMoving) return;

    const dirs: [number, number][] = [
      [0, -1], [0, 1], [-1, 0], [1, 0],
      [-1, -1], [1, -1], [-1, 1], [1, 1],
    ];
    for (let i = dirs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
    }

    for (const [dx, dy] of dirs) {
      const nc = this.cx + dx;
      const nr = this.cy + dy;
      if (this.canMoveTo(nc, nr)) {
        this.walkTo(nc, nr);
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
        if (g === undefined || !this.mapDef.walkableGround.has(g)) return false;
        const d = this.mapDef.decoLayer[gr]?.[gc];
        if (d !== undefined && d >= 0 && this.mapDef.solidDeco.has(d))
          return false;
      }
    }
    return true;
  }

  private walkTo(cx: number, cy: number) {
    this.isMoving = true;
    this.cx = cx;
    this.cy = cy;

    this.playAnim(this.walkAnimKeys, 5);

    const dest = cartToIso(cx, cy);
    const dur = 400 + Math.random() * 300;

    this.bobTween = this.scene.tweens.add({
      targets: this.sprite,
      y: -3,
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
      ease: "Quad.easeInOut",
      onUpdate: () => {
        this.setDepth(Math.floor(this.y / TILE_H) + this.obj.h / SRC_TILE);
      },
      onComplete: () => {
        this.isMoving = false;
        this.sprite.y = 0;
        this.setDepth(this.cy + this.obj.h / SRC_TILE);
        this.playAnim(this.idleAnimKeys, this.idleFps);
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
