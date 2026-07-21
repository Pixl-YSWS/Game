import Phaser from "phaser";
import { cartToIso, TILE_W, TILE_H } from "../utils/IsoUtils";
import type { PlayerState } from "../types/network";
import type { MapDef } from "../types/map";
import { FONT_CHAT, COLORS, EMOTE_ATLAS } from "../ui/theme";
import { emoteFrame } from "../ui/emotes";
import { CozyAvatar } from "./CozyAvatar";
import { WATER } from "../world/tileset";
import { CollisionMap } from "../world/collision";
import {
  PRESET_OUTFITS,
  defaultOutfitIndex,
  decodeOutfit,
  decodePresetChar,
  clampOutfit,
  type Dir,
  type Outfit,
} from "../world/cozyChar";

export type { PlayerState };

const STEP_MS = 120;
const RUN_STEP_MS = 72;

// Free-movement speeds, matching the old tile-step cadence (16px per step).
const WALK_SPEED = (TILE_W * 1000) / STEP_MS; // ≈133 px/s
const RUN_SPEED = (TILE_W * 1000) / RUN_STEP_MS; // ≈222 px/s

// Feet hitbox (relative to the container centre): a small box around the
// avatar's feet so the body/head may overlap walls and canopies visually
// while the feet collide with the art-tight rects.
const FEET_OFF_Y = 4;
const FEET_HW = 4.5;
const FEET_HH = 3;

const AVATAR_FOOT_Y = TILE_H / 2 + 3;

// Swimming: hide this many source px of the lower body and move slower.
const SWIM_SUBMERGE_PX = 7;
const SWIM_SPEED_MUL = 0.6;

function resolveOutfit(state: PlayerState): Outfit {
  if (state.skin) {
    const o = decodeOutfit(state.skin);
    if (o) return clampOutfit(o);
  }
  const idx =
    state.char !== undefined &&
    state.char >= 0 &&
    state.char < PRESET_OUTFITS.length
      ? state.char
      : defaultOutfitIndex(state.id);
  return PRESET_OUTFITS[idx];
}

export class Player extends Phaser.GameObjects.Container {
  private avatar: CozyAvatar;
  private nameTag: Phaser.GameObjects.Text;
  private shadow: Phaser.GameObjects.Ellipse;
  private mapDef: MapDef;
  private collision: CollisionMap;

  private walking = false;
  private walkBob?: Phaser.Tweens.Tween;
  private vaulting = false;
  private dustDist = 0;
  private animKey = "";

  public cx: number;
  public cy: number;
  public playerId: string;
  public isLocal: boolean;

  private isMoving = false;

  private inputDir = { dx: 0, dy: 0 };

  private dir: Dir = "down";
  private facingLeft = false;

  private bubble?: Phaser.GameObjects.Container;
  private bubbleTimer?: Phaser.Time.TimerEvent;

  private speakIcon?: Phaser.GameObjects.Image;
  private speakTimer?: Phaser.Time.TimerEvent;
  private speakTween?: Phaser.Tweens.Tween;
  private speakBaseScale = 1;

  private idleBob?: Phaser.Tweens.Tween;

  private isSwimming = false;
  private ripple?: Phaser.GameObjects.Ellipse;

  private stepCount = 0;

  private running = false;

  private speedMul = 1;

  private lastRemoteMoveT = 0;

  constructor(
    scene: Phaser.Scene,
    state: PlayerState,
    isLocal: boolean,
    mapDef: MapDef,
  ) {
    const { x, y } = cartToIso(state.cx, state.cy);
    super(scene, x + TILE_W / 2, y + TILE_H / 2);

    this.playerId = state.id;
    this.cx = state.cx;
    this.cy = state.cy;
    this.isLocal = isLocal;
    this.mapDef = mapDef;
    this.collision = new CollisionMap(mapDef);

    this.shadow = scene.add.ellipse(
      0,
      5,
      TILE_W * 0.7,
      TILE_H * 0.4,
      0x000000,
      0.25,
    );

    this.avatar = new CozyAvatar(scene, resolveOutfit(state));
    const presetChar = decodePresetChar(state.skin);
    if (presetChar) this.avatar.setPresetChar(presetChar);
    this.avatar.setPosition(0, AVATAR_FOOT_Y);

    const verified = state.verified ?? false;
    this.nameTag = scene.add
      .text(0, -TILE_H, verified ? `✓ ${state.name}` : state.name, {
        fontSize: "16px",
        fontFamily: FONT_CHAT,
        color: verified ? COLORS.good : "#ffffff",
        stroke: "#000000",
        strokeThickness: 5,
      })
      .setOrigin(0.5, 1)
      .setResolution(4)
      .setScale(0.34);

    this.add([this.shadow, this.avatar, this.nameTag]);
    scene.add.existing(this);
    this.setDepth(state.cy + 1.5);
    this.startIdleBob();
    this.updateSwimState();
  }

  assignId(id: string) {
    this.playerId = id;
  }

  setCharacter(index: number) {
    this.setAppearance(index, undefined);
  }

  setAppearance(index: number, skin?: string) {
    const presetChar = decodePresetChar(skin);
    if (presetChar) {
      this.avatar.setPresetChar(presetChar);
    } else {
      this.avatar.setOutfit(
        resolveOutfit({
          id: this.playerId,
          cx: this.cx,
          cy: this.cy,
          name: "",
          char: index,
          skin,
        }),
      );
    }
    this.avatar.setAnim(
      this.isMoving ? "walk" : "idle",
      this.dir,
      this.facingLeft,
    );
  }

  makeClickable(cursor: string, onClick: () => void): this {
    this.setSize(TILE_W, TILE_H + 28);
    this.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(
        -TILE_W / 2,
        -TILE_H - 16,
        TILE_W,
        TILE_H + 28,
      ),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      cursor,
    });
    this.on("pointerdown", onClick);
    return this;
  }

  setMap(mapDef: MapDef) {
    this.mapDef = mapDef;
    this.collision = new CollisionMap(mapDef);
  }

  private setDirection(dx: number, dy: number) {
    if (dx !== 0) {
      this.dir = "side";
      this.facingLeft = dx < 0;
    } else if (dy < 0) {
      this.dir = "up";
    } else if (dy > 0) {
      this.dir = "down";
    }
  }

  private startStepAnim(dx: number, dy: number, dur: number) {
    this.setDirection(dx, dy);
    this.animKey = `walk:${this.dir}:${this.facingLeft}`;
    this.avatar.setAnim("walk", this.dir, this.facingLeft);
    this.stopIdleBob();
    this.scene.tweens.killTweensOf(this.avatar);
    this.scene.tweens.add({
      targets: this.avatar,
      y: AVATAR_FOOT_Y - 2,
      duration: dur / 2,
      ease: "Sine.easeOut",
      yoyo: true,
    });
    if (this.stepCount++ % 2 === 0) this.spawnDust();
  }

  private returnToIdle() {
    if (!this.scene) return;
    this.scene.tweens.killTweensOf(this.avatar);
    this.animKey = `idle:${this.dir}:${this.facingLeft}`;
    this.avatar.setAnim("idle", this.dir, this.facingLeft);
    this.startIdleBob();
  }

  private startIdleBob() {
    if (!this.scene) return;
    this.stopIdleBob();
    this.avatar.y = AVATAR_FOOT_Y;
    this.idleBob = this.scene.tweens.add({
      targets: this.avatar,
      y: AVATAR_FOOT_Y - 0.8,
      duration: 1100,
      ease: "Sine.easeInOut",
      yoyo: true,
      repeat: -1,
    });
  }

  private stopIdleBob() {
    this.idleBob?.stop();
    this.idleBob = undefined;
  }

  private spawnDust() {
    if (!this.scene) return;
    const puff = this.scene.add
      .ellipse(this.x, this.y + 6, 5, 3, 0xd8cba8, 0.4)
      .setDepth(this.depth - 0.5);
    this.scene.tweens.add({
      targets: puff,
      scaleX: 2,
      scaleY: 2,
      alpha: 0,
      y: puff.y - 2,
      duration: 280,
      ease: "Quad.easeOut",
      onComplete: () => puff.destroy(),
    });
  }

  /**
   * Vault over a single blocking tile (e.g. a fence) in the facing/held
   * direction, FPS-style, landing on the open tile two cells away.
   */
  tryJump(): boolean {
    if (this.vaulting) return false;

    let dx = this.inputDir.dx;
    let dy = this.inputDir.dy;
    if (dx === 0 && dy === 0) {
      if (this.dir === "up") dy = -1;
      else if (this.dir === "down") dy = 1;
      else dx = this.facingLeft ? -1 : 1;
    }
    // Collapse diagonals to a single axis (prefer horizontal).
    if (dx !== 0 && dy !== 0) dy = 0;
    if (dx === 0 && dy === 0) return false;

    const mid = { cx: this.cx + dx, cy: this.cy + dy };
    const land = { cx: this.cx + 2 * dx, cy: this.cy + 2 * dy };
    // Only vault when something blocks the next tile and the far tile is clear.
    if (!this.collision.isBlocked(mid.cx, mid.cy)) return false;
    if (this.collision.isBlocked(land.cx, land.cy)) return false;

    this.setDirection(dx, dy);
    this.vaulting = true;
    this.isMoving = true;
    this.cx = land.cx;
    this.cy = land.cy;

    const { x, y } = cartToIso(land.cx, land.cy);
    const dur = 320;

    this.applyAnim("walk");
    this.stopIdleBob();
    this.walkBob?.stop();
    this.walkBob = undefined;
    this.walking = false;
    this.scene.tweens.killTweensOf(this.avatar);
    // Arc the avatar up and back down for a hop.
    this.scene.tweens.add({
      targets: this.avatar,
      y: AVATAR_FOOT_Y - 18,
      duration: dur / 2,
      ease: "Sine.easeOut",
      yoyo: true,
      onComplete: () => {
        this.avatar.y = AVATAR_FOOT_Y;
      },
    });

    this.scene.tweens.add({
      targets: this,
      x: x + TILE_W / 2,
      y: y + TILE_H / 2,
      duration: dur,
      ease: "Linear",
      onComplete: () => {
        if (!this.scene) return;
        this.vaulting = false;
        this.isMoving = false;
        this.updateSwimState();
        this.spawnDust();
        this.returnToIdle();
      },
    });

    return true;
  }

  setSpeedMultiplier(mul: number) {
    this.speedMul = Phaser.Math.Clamp(mul, 0.25, 8);
  }

  teleport(cx: number, cy: number): boolean {
    const { cols, rows } = this.mapDef;
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return false;
    this.scene?.tweens.killTweensOf(this);
    this.isMoving = false;
    this.vaulting = false;
    this.walkBob?.stop();
    this.walkBob = undefined;
    this.walking = false;
    this.cx = cx;
    this.cy = cy;
    const { x, y } = cartToIso(cx, cy);
    this.setPosition(x + TILE_W / 2, y + TILE_H / 2);
    this.returnToIdle();
    this.updateSwimState();
    return true;
  }

  private isWaterTile(cx: number, cy: number): boolean {
    return this.mapDef.groundLayer[cy]?.[cx] === WATER;
  }

  /** Sync the swimming visual (submerged body + ripple) to the current tile. */
  private updateSwimState() {
    const swimming = this.isWaterTile(this.cx, this.cy);
    if (swimming === this.isSwimming) return;
    this.isSwimming = swimming;
    this.avatar.setSubmerged(swimming ? SWIM_SUBMERGE_PX : 0);
    this.shadow.setVisible(!swimming);
    if (swimming) {
      if (!this.ripple) {
        this.ripple = this.scene.add
          .ellipse(0, AVATAR_FOOT_Y - SWIM_SUBMERGE_PX, TILE_W * 0.85, 6, 0x9fd8ff, 0.5)
          .setOrigin(0.5, 0.5);
        this.addAt(this.ripple, 1);
        this.scene.tweens.add({
          targets: this.ripple,
          scaleX: 1.18,
          duration: 900,
          yoyo: true,
          repeat: -1,
          ease: "Sine.easeInOut",
        });
      }
      this.ripple.setVisible(true);
    } else {
      this.ripple?.setVisible(false);
    }
  }

  handleInput(
    cursors: Phaser.Types.Input.Keyboard.CursorKeys,
    wasd: {
      W: Phaser.Input.Keyboard.Key;
      A: Phaser.Input.Keyboard.Key;
      S: Phaser.Input.Keyboard.Key;
      D: Phaser.Input.Keyboard.Key;
    },
    delta: number,

    touch?: { dx: number; dy: number },
  ): boolean {
    this.running = !!cursors.shift?.isDown;

    let dx = 0,
      dy = 0;
    if (cursors.left!.isDown || wasd.A.isDown) dx = -1;
    else if (cursors.right!.isDown || wasd.D.isDown) dx = 1;
    if (cursors.up!.isDown || wasd.W.isDown) dy = -1;
    else if (cursors.down!.isDown || wasd.S.isDown) dy = 1;

    if (dx === 0 && dy === 0 && touch && (touch.dx !== 0 || touch.dy !== 0)) {
      dx = touch.dx;
      dy = touch.dy;
    }

    this.inputDir = { dx, dy };

    if (this.vaulting) return false;

    if (dx === 0 && dy === 0) {
      this.stopWalking();
      return false;
    }

    // Free movement: velocity scaled by the frame delta, collided against
    // the map's art-tight hitboxes (axis-separated → wall sliding for free).
    const swim = this.isSwimming ? SWIM_SPEED_MUL : 1;
    const speed =
      (this.running ? RUN_SPEED : WALK_SPEED) * this.speedMul * swim;
    const mag = Math.hypot(dx, dy);
    const step = (speed * Math.min(delta, 100)) / 1000;
    const vx = (dx / mag) * step;
    const vy = (dy / mag) * step;

    const feetY = this.y + FEET_OFF_Y;
    const moved = this.collision.moveBox(
      this.x,
      feetY,
      FEET_HW,
      FEET_HH,
      vx,
      vy,
    );
    const nx = moved.x;
    const ny = moved.y - FEET_OFF_Y;
    const dist = Math.hypot(nx - this.x, ny - this.y);
    this.setPosition(nx, ny);

    this.setDirection(dx, dy);
    this.startWalking();

    const tcx = Math.floor(this.x / TILE_W);
    const tcy = Math.floor(this.y / TILE_H);
    if (tcx !== this.cx || tcy !== this.cy) {
      this.cx = tcx;
      this.cy = tcy;
      this.updateSwimState();
    }

    this.dustDist += dist;
    if (this.dustDist >= TILE_W * 1.5) {
      this.dustDist = 0;
      this.spawnDust();
    }

    this.isMoving = dist > 0.01;
    return this.isMoving;
  }

  // Continuous walk animation: swap to the walk anim (guarded so direction
  // changes don't restart it needlessly) and run a looping foot bob.
  private startWalking() {
    this.applyAnim("walk");
    if (this.walking) return;
    this.walking = true;
    this.stopIdleBob();
    this.scene.tweens.killTweensOf(this.avatar);
    this.avatar.y = AVATAR_FOOT_Y;
    this.walkBob = this.scene.tweens.add({
      targets: this.avatar,
      y: AVATAR_FOOT_Y - 1.5,
      duration: 110,
      ease: "Sine.easeInOut",
      yoyo: true,
      repeat: -1,
    });
  }

  private stopWalking() {
    if (!this.walking) return;
    this.walking = false;
    this.isMoving = false;
    this.walkBob?.stop();
    this.walkBob = undefined;
    this.returnToIdle();
  }

  /** Drop to the idle anim (e.g. when a menu opens mid-walk). */
  idle() {
    if (!this.vaulting) this.stopWalking();
  }

  /** Apply an avatar anim only when (anim, dir, facing) actually changed. */
  private applyAnim(anim: "walk" | "idle") {
    const key = `${anim}:${this.dir}:${this.facingLeft}`;
    if (key === this.animKey) return;
    this.animKey = key;
    this.avatar.setAnim(anim, this.dir, this.facingLeft);
  }

  showSpeaking(ms = 1600) {
    if (!this.scene) return;
    if (!this.speakIcon) {
      this.speakIcon = this.scene.add
        .image(0, -TILE_H - 22, "mc-icons", "icon_microphone")
        .setDisplaySize(7, 7)
        .setTint(0x7bdc8b);
      this.speakBaseScale = this.speakIcon.scaleX;
      this.add(this.speakIcon);
    }
    if (!this.speakIcon.visible) {
      this.speakIcon.setVisible(true).setAlpha(1).setScale(this.speakBaseScale);
      this.speakTween = this.scene.tweens.add({
        targets: this.speakIcon,
        scaleX: this.speakBaseScale * 1.25,
        scaleY: this.speakBaseScale * 1.25,
        duration: 360,
        yoyo: true,
        repeat: -1,
      });
    }
    this.speakTimer?.remove();
    this.speakTimer = this.scene.time.delayedCall(ms, () => {
      this.speakTween?.stop();
      this.speakTween = undefined;
      this.speakIcon?.setVisible(false).setScale(this.speakBaseScale);
    });
  }

  destroy(fromScene?: boolean) {
    this.scene?.tweens.killTweensOf(this);
    this.scene?.tweens.killTweensOf(this.avatar);
    this.stopIdleBob();
    this.bubbleTimer?.remove();
    this.speakTimer?.remove();
    this.inputDir = { dx: 0, dy: 0 };
    super.destroy(fromScene);
  }

  applyServerState(state: PlayerState) {
    const dx = state.cx - this.cx;
    const dy = state.cy - this.cy;
    this.cx = state.cx;
    this.cy = state.cy;
    this.updateSwimState();

    const now = this.scene.time.now;
    const elapsed = this.lastRemoteMoveT ? now - this.lastRemoteMoveT : STEP_MS;
    this.lastRemoteMoveT = now;
    const dur = Phaser.Math.Clamp(elapsed, RUN_STEP_MS, STEP_MS);
    this.startStepAnim(dx, dy, dur);
    const { x, y } = cartToIso(state.cx, state.cy);
    this.scene.tweens.killTweensOf(this);
    this.scene.tweens.add({
      targets: this,
      x: x + TILE_W / 2,
      y: y + TILE_H / 2,
      duration: dur,
      ease: "Linear",
      onComplete: () => this.returnToIdle(),
    });
  }

  showBubble(content: string, kind: "chat" | "emote" = "chat") {
    if (!this.scene) return;
    this.bubble?.destroy();
    this.bubbleTimer?.remove();

    const isEmote = kind === "emote";
    const children: Phaser.GameObjects.GameObject[] = [];

    if (isEmote) {
      const sprite = this.scene.add
        .image(0, 0, EMOTE_ATLAS, emoteFrame(content))
        .setOrigin(0.5)
        .setDisplaySize(28, 28);
      children.push(sprite);
    } else {
      const label = this.scene.add
        .text(0, 0, content, {
          fontFamily: FONT_CHAT,
          fontSize: "15px",
          color: COLORS.text,
          align: "center",
          wordWrap: { width: 130 },
        })
        .setOrigin(0.5)
        .setResolution(4);
      const padX = 6;
      const padY = 4;
      const bg = this.scene.add
        .rectangle(
          0,
          0,
          label.width + padX * 2,
          label.height + padY * 2,
          0x0a0f1c,
          0.82,
        )
        .setStrokeStyle(1, 0xffffff, 0.25)
        .setOrigin(0.5);
      children.push(bg, label);
    }

    const rest = 0.4;

    let yOffset: number;
    if (isEmote) {
      yOffset = -TILE_H - 22;
    } else {
      const nameTopY = this.nameTag.y - this.nameTag.displayHeight;
      const bubbleH = (children[0] as Phaser.GameObjects.Rectangle).height;
      const gap = 3;
      yOffset = nameTopY - gap - (bubbleH * rest) / 2;
    }

    const bubble = this.scene.add.container(0, yOffset, children);
    bubble.setDepth(100000);
    this.add(bubble);
    this.bubble = bubble;

    bubble.setScale(rest * 0.6);
    this.scene.tweens.add({
      targets: bubble,
      scale: rest,
      duration: 120,
      ease: "Back.easeOut",
    });
    this.bubbleTimer = this.scene.time.delayedCall(
      isEmote ? 1800 : 4000,
      () => {
        if (!this.scene) return;
        this.scene.tweens.add({
          targets: bubble,
          alpha: 0,
          duration: 200,
          onComplete: () => bubble.destroy(),
        });
      },
    );
  }
}
