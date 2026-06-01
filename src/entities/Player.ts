import Phaser from "phaser";
import { cartToIso, TILE_W, TILE_H } from "../utils/IsoUtils";
import type { PlayerState } from "../types/network";
import type { MapDef } from "../types/map";
import { FONT_CHAT, COLORS, EMOTE_ATLAS } from "../ui/theme";
import { emoteFrame } from "../ui/emotes";
import { CozyAvatar } from "./CozyAvatar";
import {
  PRESET_OUTFITS,
  defaultOutfitIndex,
  decodeOutfit,
  clampOutfit,
  type Dir,
  type Outfit,
} from "../world/cozyChar";

export type { PlayerState };

const STEP_MS = 120;
const RUN_STEP_MS = 72;

const AVATAR_FOOT_Y = TILE_H / 2 + 3;

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

    this.shadow = scene.add.ellipse(
      0,
      5,
      TILE_W * 0.7,
      TILE_H * 0.4,
      0x000000,
      0.25,
    );

    this.avatar = new CozyAvatar(scene, resolveOutfit(state));
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
  }

  assignId(id: string) {
    this.playerId = id;
  }

  setCharacter(index: number) {
    this.setAppearance(index, undefined);
  }

  setAppearance(index: number, skin?: string) {
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
  }

  moveToTile(cx: number, cy: number): boolean {
    if (this.isMoving) return false;
    if (!this.canMoveToTile(cx, cy)) return false;

    const dx = cx - this.cx;
    const dy = cy - this.cy;
    this.cx = cx;
    this.cy = cy;
    this.isMoving = true;

    const diag = dx !== 0 && dy !== 0 ? Math.SQRT2 : 1;
    const dur = ((this.running ? RUN_STEP_MS : STEP_MS) * diag) / this.speedMul;
    this.startStepAnim(dx, dy, dur);

    const { x, y } = cartToIso(cx, cy);

    this.scene.tweens.add({
      targets: this,
      x: x + TILE_W / 2,
      y: y + TILE_H / 2,
      duration: dur,
      ease: "Linear",
      onComplete: () => {
        if (!this.scene) return;
        this.isMoving = false;

        const { dx: hx, dy: hy } = this.inputDir;
        if (hx !== 0 || hy !== 0) {
          if (!this.attemptStep(hx, hy)) this.returnToIdle();
        } else {
          this.returnToIdle();
        }
      },
    });

    return true;
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

  private attemptStep(dx: number, dy: number): boolean {
    if (dx === 0 && dy === 0) return false;
    if (dx !== 0 && dy !== 0) {
      if (this.canMoveToTile(this.cx + dx, this.cy + dy)) {
        return this.moveToTile(this.cx + dx, this.cy + dy);
      }
      if (this.canMoveToTile(this.cx + dx, this.cy))
        return this.moveToTile(this.cx + dx, this.cy);
      if (this.canMoveToTile(this.cx, this.cy + dy))
        return this.moveToTile(this.cx, this.cy + dy);
      return false;
    }
    return this.moveToTile(this.cx + dx, this.cy + dy);
  }

  setSpeedMultiplier(mul: number) {
    this.speedMul = Phaser.Math.Clamp(mul, 0.25, 8);
  }

  teleport(cx: number, cy: number): boolean {
    const { cols, rows } = this.mapDef;
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return false;
    this.scene?.tweens.killTweensOf(this);
    this.isMoving = false;
    this.cx = cx;
    this.cy = cy;
    const { x, y } = cartToIso(cx, cy);
    this.setPosition(x + TILE_W / 2, y + TILE_H / 2);
    this.returnToIdle();
    return true;
  }

  private canMoveToTile(cx: number, cy: number): boolean {
    const { cols, rows, groundLayer, decoLayer, walkableGround, solidDeco } =
      this.mapDef;
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return false;
    const groundIdx = groundLayer[cy]?.[cx];
    if (groundIdx === undefined || !walkableGround.has(groundIdx)) return false;
    const decoIdx = decoLayer[cy]?.[cx];
    if (decoIdx !== undefined && decoIdx >= 0 && solidDeco.has(decoIdx))
      return false;
    return true;
  }

  handleInput(
    cursors: Phaser.Types.Input.Keyboard.CursorKeys,
    wasd: {
      W: Phaser.Input.Keyboard.Key;
      A: Phaser.Input.Keyboard.Key;
      S: Phaser.Input.Keyboard.Key;
      D: Phaser.Input.Keyboard.Key;
    },
    _delta: number,

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

    if (this.isMoving || (dx === 0 && dy === 0)) return false;

    return this.attemptStep(dx, dy);
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
