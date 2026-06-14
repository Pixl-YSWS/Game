import Phaser from "phaser";
import { cartToIso, TILE_W, TILE_H } from "../utils/IsoUtils";
import type { MapObject, MapDef } from "../types/map";
import { TS, GRASS, GRASS_DARK } from "../world/tileset";
import { EMOTE_ATLAS } from "../ui/theme";
import { emoteFrame } from "../ui/emotes";

export function popHeart(scene: Phaser.Scene, x: number, y: number): void {
  const heart = scene.add
    .image(x, y, EMOTE_ATLAS, emoteFrame("heart"))
    .setDisplaySize(12, 12)
    .setDepth(100000);
  scene.tweens.add({
    targets: heart,
    y: y - 14,
    alpha: { from: 1, to: 0 },
    scale: { from: heart.scale * 0.6, to: heart.scale },
    duration: 750,
    ease: "Quad.easeOut",
    onComplete: () => heart.destroy(),
  });
}

const SRC_TILE = 16;

interface FrameDef {
  sx: number;
  sy: number;
}

function walkFrames(key: string): FrameDef[] {
  if (key === TS.cow) {
    // Row 0 is the real walk cycle (legs alternate); row 3 is a standing idle.
    const f = (col: number) => ({ sx: col * 32, sy: 0 });
    return [f(0), f(1), f(2), f(3)];
  }
  if (key === TS.chicken) {
    // Row 0 = upright stepping (walk); row 2 = head-down peck (idle/eat).
    const f = (col: number) => ({ sx: col * 16, sy: 0 });
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
  private walkDir: [number, number] = [0, 0];
  private stepsLeft = 0;
  // Tiles this animal occupies (shared with siblings so they don't overlap).
  private occupied: Set<string>;
  private held = new Set<string>();

  static ANIMAL_KEYS: ReadonlySet<string> = new Set([TS.cow, TS.chicken]);

  static isAnimal(key: string): boolean {
    return Animal.ANIMAL_KEYS.has(key);
  }

  constructor(
    scene: Phaser.Scene,
    obj: MapObject,
    mapDef: MapDef,
    occupied?: Set<string>,
  ) {
    const { x, y } = cartToIso(obj.cx, obj.cy);
    super(scene, x, y);
    this.cx = obj.cx;
    this.cy = obj.cy;
    this.obj = obj;
    this.mapDef = mapDef;
    this.occupied = occupied ?? new Set<string>();
    for (const t of this.footprintTiles(obj.cx, obj.cy)) {
      this.occupied.add(t);
      this.held.add(t);
    }

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
    // Long, varied rests so the animals graze/stand around instead of fidgeting.
    this.wanderTimer = this.scene.time.addEvent({
      delay: 6000 + Math.random() * 9000,
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
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ];
    for (let i = dirs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
    }

    for (const [dx, dy] of dirs) {
      if (this.canMoveTo(this.cx + dx, this.cy + dy)) {
        // Stroll a few tiles in one direction rather than a single twitchy step.
        this.walkDir = [dx, dy];
        this.stepsLeft = 2 + Math.floor(Math.random() * 4);
        const turned = this.faceTowards(dx);
        if (turned) {
          this.playAnim(this.idleAnimKeys, this.idleFps);
          this.scene.time.delayedCall(220, () => this.stepStroll(true));
        } else {
          this.stepStroll(true);
        }
        return;
      }
    }

    this.scheduleWander();
  }

  private footprintTiles(cx: number, cy: number): string[] {
    const tw = Math.ceil(this.obj.w / SRC_TILE);
    const th = Math.ceil(this.obj.h / SRC_TILE);
    const tiles: string[] = [];
    for (let r = 0; r < th; r++)
      for (let c = 0; c < tw; c++) tiles.push(`${cx + c},${cy + r}`);
    return tiles;
  }

  private canMoveTo(cx: number, cy: number): boolean {
    const tw = Math.ceil(this.obj.w / SRC_TILE);
    const th = Math.ceil(this.obj.h / SRC_TILE);
    for (let r = 0; r < th; r++) {
      for (let c = 0; c < tw; c++) {
        const gc = cx + c;
        const gr = cy + r;
        if (
          gc < 0 ||
          gr < 0 ||
          gc >= this.mapDef.cols ||
          gr >= this.mapDef.rows
        )
          return false;
        const g = this.mapDef.groundLayer[gr]?.[gc];
        if (g === undefined || !this.mapDef.walkableGround.has(g)) return false;
        // Grazing animals stick to grass — PATH tiles are drawn with a sandy
        // beach overlay, so a cow standing there looks like it's eating sand.
        if (g !== GRASS && g !== GRASS_DARK) return false;
        const d = this.mapDef.decoLayer[gr]?.[gc];
        if (d !== undefined && d >= 0 && this.mapDef.solidDeco.has(d))
          return false;
        // Blocked if another animal holds this tile (ignore our own tiles).
        const key = `${gc},${gr}`;
        if (this.occupied.has(key) && !this.held.has(key)) return false;
      }
    }
    return true;
  }

  /** Returns true if the facing actually changed. */
  private faceTowards(dx: number): boolean {
    // Cow/chicken sheets are drawn facing right; flip to face left when going left.
    if (dx === 0) return false;
    const want = dx < 0;
    if (this.sprite.flipX === want) return false;
    this.sprite.setFlipX(want);
    return true;
  }

  // Walk one tile in walkDir, then chain to the next step until the stroll ends.
  private stepStroll(first: boolean) {
    const [dx, dy] = this.walkDir;
    const nc = this.cx + dx;
    const nr = this.cy + dy;
    if (this.stepsLeft <= 0 || !this.canMoveTo(nc, nr)) {
      this.endStroll();
      return;
    }
    this.stepsLeft--;
    this.isMoving = true;

    // Reserve the destination now (hold both tiles during transit) so no other
    // animal can step into it; release the vacated tiles once we arrive.
    const oldFoot = this.footprintTiles(this.cx, this.cy);
    const newFoot = this.footprintTiles(nc, nr);
    for (const t of newFoot) {
      this.occupied.add(t);
      this.held.add(t);
    }
    this.cx = nc;
    this.cy = nr;

    // Start the walk cycle once at the top of a stroll and let it run across all
    // the steps so the legs keep moving without restarting each tile.
    if (first) this.playAnim(this.walkAnimKeys, 6);

    const dest = cartToIso(nc, nr);
    const dur = 360 + Math.random() * 160;

    // No vertical bob — the walk-cycle frames carry the motion, the body just
    // glides along x/y, so the animal walks instead of hopping.
    this.moveTween = this.scene.tweens.add({
      targets: this,
      x: dest.x,
      y: dest.y,
      duration: dur,
      ease: "Linear",
      onUpdate: () => {
        this.setDepth(Math.floor(this.y / TILE_H) + this.obj.h / SRC_TILE);
      },
      onComplete: () => {
        const keep = new Set(newFoot);
        for (const t of oldFoot)
          if (!keep.has(t)) {
            this.occupied.delete(t);
            this.held.delete(t);
          }
        this.stepStroll(false);
      },
    });
  }

  private endStroll() {
    this.isMoving = false;
    this.sprite.y = 0;
    this.setDepth(this.cy + this.obj.h / SRC_TILE);
    this.playAnim(this.idleAnimKeys, this.idleFps);
    this.scheduleWander();
  }

  /** Snap to a saved tile when restoring a village's last-known layout. */
  placeAt(cx: number, cy: number) {
    if (cx < 0 || cy < 0 || cx >= this.mapDef.cols || cy >= this.mapDef.rows)
      return;
    for (const t of this.held) this.occupied.delete(t);
    this.held.clear();
    this.cx = cx;
    this.cy = cy;
    for (const t of this.footprintTiles(cx, cy)) {
      this.occupied.add(t);
      this.held.add(t);
    }
    const { x, y } = cartToIso(cx, cy);
    this.setPosition(x, y);
    this.setDepth(this.obj.flat ? 0.4 : cy + this.obj.h / SRC_TILE);
  }

  /** World-space anchor (top-centre) for a floating prompt above the animal. */
  getPetAnchor(): { x: number; y: number } {
    const w = (this.obj.w / SRC_TILE) * TILE_W;
    return { x: this.x + w / 2, y: this.y - 4 };
  }

  /** True if (px,py) is orthogonally adjacent to (or on) the animal's tiles. */
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

  /** Happy reaction when the player pets it: a wiggle + a floating heart. */
  pet() {
    const w = (this.obj.w / SRC_TILE) * TILE_W;
    popHeart(this.scene, this.x + w / 2, this.y - 4);
    this.scene.tweens.killTweensOf(this.sprite);
    this.sprite.angle = 0;
    // this.scene.tweens.add({
    //   targets: this.sprite,
    //   angle: { from: -7, to: 7 },
    //   duration: 90,
    //   yoyo: true,
    //   repeat: 3,
    //   ease: "Sine.easeInOut",
    //   onComplete: () => {
    //     this.sprite.angle = 0;
    //   },
    // });
  }

  destroy(fromScene?: boolean) {
    this.animTimer?.remove(false);
    this.wanderTimer?.remove(false);
    this.moveTween?.remove();
    for (const t of this.held) this.occupied.delete(t);
    this.held.clear();
    super.destroy(fromScene);
  }
}
