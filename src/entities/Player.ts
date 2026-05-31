import Phaser from "phaser";
import { cartToIso, TILE_W, TILE_H } from "../utils/IsoUtils";
import type { PlayerState } from "../types/network";
import type { MapDef } from "../types/map";
import { FONT_CHAT, FONT_EMOJI, COLORS } from "../ui/theme";

export type { PlayerState };

const STEP_MS = 120; // ms per tile — one step every 120 ms (~8 tiles/sec)
const RUN_STEP_MS = 72; // holding Shift sprints at ~14 tiles/sec

// Resting y of the character sprite within the container: origin at the feet,
// nudged down so it reads as standing on the tile. The walk-hop and idle bob
// both animate around this baseline.
const SPRITE_FOOT_Y = TILE_H / 2 + 2;

// Kenney pixel-platformer "chars" sheet: 9 cols × 3 rows of 24×24 tiles.
// The top row holds humanoid characters as {idle, walk} frame pairs, so each
// playable colour is a base frame (idle) with base+1 as its walking frame.
const CHAR_SHEET = "chars";
// Idle frames for the selectable skins; base+1 is each one's walk frame.
export const CHAR_BASES = [0, 2, 4, 6, 8] as const;

// Deterministic default skin *index* from a player id, used when the player
// hasn't explicitly chosen one.
export function charIndexFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % CHAR_BASES.length;
}

export class Player extends Phaser.GameObjects.Container {
  private sprite: Phaser.GameObjects.Image;
  private nameTag: Phaser.GameObjects.Text;
  private shadow: Phaser.GameObjects.Ellipse;
  private mapDef: MapDef;

  public cx: number;
  public cy: number;
  public playerId: string;
  public isLocal: boolean;

  // True while the step tween is playing; blocks new local moves.
  private isMoving = false;
  // Direction held at the end of the current step — drives auto-continuation.
  private inputDir = { dx: 0, dy: 0 };
  // Selected skin index + its idle frame (base+1 is the walk frame).
  private charIndex: number;
  private charBase: number;
  // Bubble shown above the head for chat lines / emotes (lazily created).
  private bubble?: Phaser.GameObjects.Container;
  private bubbleTimer?: Phaser.Time.TimerEvent;
  // Gentle breathing bob while standing still (looping); stopped while walking.
  private idleBob?: Phaser.Tweens.Tween;
  // Counts steps so footstep dust puffs on alternate tiles, not every one.
  private stepCount = 0;
  // True while Shift is held — the local player sprints (shorter step time).
  private running = false;
  // Scene time of the last remote move, so remote interpolation can match the
  // sender's actual cadence (and so look right when a peer is sprinting).
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
      4,
      TILE_W * 0.7,
      TILE_H * 0.4,
      0x000000,
      0.25,
    );

    this.charIndex = state.char ?? charIndexFor(state.id);
    this.charBase = CHAR_BASES[this.charIndex];
    // 24px character standing on the tile: origin at the feet, nudged down so
    // it reads as occupying the tile rather than floating above it.
    this.sprite = scene.add
      .image(0, SPRITE_FOOT_Y, CHAR_SHEET, this.charBase)
      .setOrigin(0.5, 1);

    // Verified Hack Clubbers get a green name + check badge.
    const verified = state.verified ?? false;
    // Rendered large then scaled down so it stays crisp under the world
    // camera's zoom without dominating the screen.
    this.nameTag = scene.add
      .text(0, -TILE_H - 2, verified ? `✓ ${state.name}` : state.name, {
        fontSize: "16px",
        fontFamily: FONT_CHAT,
        color: verified ? COLORS.good : "#ffffff",
        stroke: "#000000",
        strokeThickness: 5,
      })
      .setOrigin(0.5, 1)
      .setResolution(4)
      .setScale(0.34);

    this.add([this.shadow, this.sprite, this.nameTag]);
    scene.add.existing(this);
    this.setDepth(state.cy + 1.5);
    this.startIdleBob();
  }

  assignId(id: string) {
    this.playerId = id;
  }

  // Swap the character skin live (from the picker / a remote's appearance).
  setCharacter(index: number) {
    if (index < 0 || index >= CHAR_BASES.length) return;
    this.charIndex = index;
    this.charBase = CHAR_BASES[index];
    this.sprite.setFrame(this.isMoving ? this.charBase + 1 : this.charBase);
  }

  // Make this avatar clickable (hand cursor + callback). Used for remote
  // players so you can click someone to wave at them.
  makeClickable(cursor: string, onClick: () => void): this {
    this.setSize(TILE_W, TILE_H + 12);
    this.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(-TILE_W / 2, -TILE_H, TILE_W, TILE_H + 16),
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
    this.cx = cx;
    this.cy = cy;
    this.isMoving = true;
    const dur = this.running ? RUN_STEP_MS : STEP_MS;
    this.startStepAnim(dx, dur);

    const { x, y } = cartToIso(cx, cy);

    this.scene.tweens.add({
      targets: this,
      x: x + TILE_W / 2,
      y: y + TILE_H / 2,
      duration: dur,
      ease: "Linear",
      onComplete: () => {
        // The player may have been destroyed mid-step (e.g. a world switch
        // tore down the scene while walking). Bail before touching a dead
        // scene, otherwise the chained step throws and halts the game loop.
        if (!this.scene) return;
        this.isMoving = false;
        // If the player is still holding a direction, chain the next step
        // immediately — no gap between tiles, classic retro feel.
        const { dx: hx, dy: hy } = this.inputDir;
        if (hx !== 0 || hy !== 0) {
          this.moveToTile(this.cx + hx, this.cy + hy);
        } else {
          this.returnToIdle();
        }
      },
    });

    return true;
  }

  // Show the walking frame and face the direction of travel. The sheet's
  // characters face left by default, so flip for rightward movement.
  private setStepFrame(dx: number) {
    this.sprite.setFrame(this.charBase + 1);
    if (dx > 0) this.sprite.setFlipX(true);
    else if (dx < 0) this.sprite.setFlipX(false);
  }

  // One footstep: walk frame + a small vertical hop, plus a dust puff on
  // alternate tiles. The hop is a yoyo over exactly one step (so chained
  // steps read as a continuous bouncing walk cycle) — `dur` keeps it in sync
  // whether the player is walking or sprinting.
  private startStepAnim(dx: number, dur: number) {
    this.setStepFrame(dx);
    this.stopIdleBob();
    this.scene.tweens.killTweensOf(this.sprite);
    this.scene.tweens.add({
      targets: this.sprite,
      y: SPRITE_FOOT_Y - 2,
      duration: dur / 2,
      ease: "Sine.easeOut",
      yoyo: true,
    });
    if (this.stepCount++ % 2 === 0) this.spawnDust();
  }

  // Settle back to the idle frame at rest height and resume the breathing bob.
  private returnToIdle() {
    if (!this.scene) return;
    this.scene.tweens.killTweensOf(this.sprite);
    this.sprite.setFrame(this.charBase);
    this.startIdleBob();
  }

  private startIdleBob() {
    if (!this.scene) return;
    this.stopIdleBob();
    this.sprite.y = SPRITE_FOOT_Y;
    this.idleBob = this.scene.tweens.add({
      targets: this.sprite,
      y: SPRITE_FOOT_Y - 0.8,
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

  // A short-lived puff of dust kicked up at the feet on a footstep. Lives in
  // scene space (not parented to the player) so it stays put as the player
  // walks on, fading and spreading before it removes itself.
  private spawnDust() {
    if (!this.scene) return;
    const puff = this.scene.add
      .ellipse(this.x, this.y + 5, 5, 3, 0xd8cba8, 0.4)
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
    // Optional held direction from the on-screen mobile D-pad. Used only when
    // no key is pressed, so a keyboard always wins if both are active.
    touch?: { dx: number; dy: number },
  ): boolean {
    // Hold Shift to sprint. createCursorKeys() exposes the Shift key, so this
    // works for both arrow-key and WASD movement.
    this.running = !!cursors.shift?.isDown;

    // Cardinal only — one direction at a time, matching classic retro games.
    let dx = 0,
      dy = 0;
    if (cursors.left!.isDown || wasd.A.isDown) dx = -1;
    else if (cursors.right!.isDown || wasd.D.isDown) dx = 1;
    else if (cursors.up!.isDown || wasd.W.isDown) dy = -1;
    else if (cursors.down!.isDown || wasd.S.isDown) dy = 1;

    // Fall back to the touch D-pad when the keyboard is idle.
    if (dx === 0 && dy === 0 && touch && (touch.dx !== 0 || touch.dy !== 0)) {
      dx = touch.dx;
      dy = touch.dy;
    }

    // Always record so onComplete can chain the next step.
    this.inputDir = { dx, dy };

    if (this.isMoving || (dx === 0 && dy === 0)) return false;

    return this.moveToTile(this.cx + dx, this.cy + dy);
  }

  destroy(fromScene?: boolean) {
    // Cancel any in-flight step tween *before* teardown so its onComplete
    // (which chains another move and touches the scene) can't fire on a
    // half-destroyed object and crash the game loop.
    this.scene?.tweens.killTweensOf(this);
    this.scene?.tweens.killTweensOf(this.sprite);
    this.stopIdleBob();
    this.bubbleTimer?.remove();
    this.inputDir = { dx: 0, dy: 0 };
    super.destroy(fromScene);
  }

  applyServerState(state: PlayerState) {
    const dx = state.cx - this.cx;
    this.cx = state.cx;
    this.cy = state.cy;
    // Interpolate over the gap since this peer's last move so a sprinting
    // peer animates at their real speed instead of a fixed walk cadence.
    const now = this.scene.time.now;
    const elapsed = this.lastRemoteMoveT ? now - this.lastRemoteMoveT : STEP_MS;
    this.lastRemoteMoveT = now;
    const dur = Phaser.Math.Clamp(elapsed, RUN_STEP_MS, STEP_MS);
    this.startStepAnim(dx, dur);
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

  // Floating speech / emote bubble above the head. Used by chat and emotes.
  // `kind` tweaks styling: a chat line vs a big emote glyph.
  showBubble(text: string, kind: "chat" | "emote" = "chat") {
    if (!this.scene) return;
    this.bubble?.destroy();
    this.bubbleTimer?.remove();

    const isEmote = kind === "emote";
    const label = this.scene.add
      .text(0, 0, text, {
        // Emotes are emoji (need the colour-emoji font); chat uses the pixel font.
        fontFamily: isEmote ? FONT_EMOJI : FONT_CHAT,
        fontSize: isEmote ? "30px" : "15px",
        color: COLORS.text,
        align: "center",
        wordWrap: { width: 130 },
      })
      .setOrigin(0.5)
      .setResolution(4);

    // Emotes float as the bare emoji (no panel behind them); only chat lines
    // get the dark speech-bubble box.
    const children: Phaser.GameObjects.GameObject[] = [];
    if (!isEmote) {
      const padX = 6;
      const padY = 4;
      const bg = this.scene.add
        .rectangle(0, 0, label.width + padX * 2, label.height + padY * 2, 0x0a0f1c, 0.82)
        .setStrokeStyle(1, 0xffffff, 0.25)
        .setOrigin(0.5);
      children.push(bg);
    }
    children.push(label);

    const bubble = this.scene.add.container(0, -TILE_H - 12, children);
    bubble.setDepth(100000);
    this.add(bubble);
    this.bubble = bubble;

    // The bubble lives in world space, so the camera zoom enlarges it; render
    // the text big (crisp) but scale the whole bubble down to a sane size.
    const rest = 0.4;
    bubble.setScale(rest * 0.6);
    this.scene.tweens.add({ targets: bubble, scale: rest, duration: 120, ease: "Back.easeOut" });
    this.bubbleTimer = this.scene.time.delayedCall(isEmote ? 1800 : 4000, () => {
      if (!this.scene) return;
      this.scene.tweens.add({
        targets: bubble,
        alpha: 0,
        duration: 200,
        onComplete: () => bubble.destroy(),
      });
    });
  }
}
