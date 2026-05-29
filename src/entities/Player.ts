import Phaser from "phaser";
import { cartToIso, TILE_W, TILE_H } from "../utils/IsoUtils";
import type { PlayerState } from "../types/network";
import type { MapDef } from "../types/map";
import { FONT, FONT_NARROW, COLORS } from "../ui/theme";

export type { PlayerState };

const STEP_MS = 120; // ms per tile — one step every 120 ms (~8 tiles/sec)

// Kenney pixel-platformer "chars" sheet: 9 cols × 3 rows of 24×24 tiles.
// The top row holds humanoid characters as {idle, walk} frame pairs, so each
// playable colour is a base frame (idle) with base+1 as its walking frame.
const CHAR_SHEET = "chars";
const CHAR_BASES = [0, 2, 4, 6, 8] as const; // distinct character colours

// Deterministically pick a character colour from a player id so the same
// player always looks the same to everyone.
function charBaseFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return CHAR_BASES[Math.abs(h) % CHAR_BASES.length];
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
  // Idle frame for this player's colour; base+1 is the walk frame.
  private charBase: number;
  // Bubble shown above the head for chat lines / emotes (lazily created).
  private bubble?: Phaser.GameObjects.Container;
  private bubbleTimer?: Phaser.Time.TimerEvent;

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

    this.charBase = charBaseFor(state.id);
    // 24px character standing on the tile: origin at the feet, nudged down so
    // it reads as occupying the tile rather than floating above it.
    this.sprite = scene.add
      .image(0, TILE_H / 2 + 2, CHAR_SHEET, this.charBase)
      .setOrigin(0.5, 1);

    this.nameTag = scene.add
      .text(0, -TILE_H - 2, state.name, {
        fontSize: "9px",
        fontFamily: FONT,
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 4,
      })
      .setOrigin(0.5, 1)
      .setResolution(4);

    this.add([this.shadow, this.sprite, this.nameTag]);
    scene.add.existing(this);
    this.setDepth(state.cy + 1.5);
  }

  assignId(id: string) {
    this.playerId = id;
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
    this.setStepFrame(dx);

    const { x, y } = cartToIso(cx, cy);

    this.scene.tweens.add({
      targets: this,
      x: x + TILE_W / 2,
      y: y + TILE_H / 2,
      duration: STEP_MS,
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
          this.sprite.setFrame(this.charBase); // back to idle
        }
      },
    });

    return true;
  }

  // Show the walking frame and face the direction of travel (sprites face
  // right by default; flip for leftward movement).
  private setStepFrame(dx: number) {
    this.sprite.setFrame(this.charBase + 1);
    if (dx < 0) this.sprite.setFlipX(true);
    else if (dx > 0) this.sprite.setFlipX(false);
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
  ): boolean {
    // Cardinal only — one direction at a time, matching classic retro games.
    let dx = 0,
      dy = 0;
    if (cursors.left!.isDown || wasd.A.isDown) dx = -1;
    else if (cursors.right!.isDown || wasd.D.isDown) dx = 1;
    else if (cursors.up!.isDown || wasd.W.isDown) dy = -1;
    else if (cursors.down!.isDown || wasd.S.isDown) dy = 1;

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
    this.bubbleTimer?.remove();
    this.inputDir = { dx: 0, dy: 0 };
    super.destroy(fromScene);
  }

  applyServerState(state: PlayerState) {
    const dx = state.cx - this.cx;
    this.cx = state.cx;
    this.cy = state.cy;
    this.setStepFrame(dx);
    const { x, y } = cartToIso(state.cx, state.cy);
    this.scene.tweens.killTweensOf(this);
    this.scene.tweens.add({
      targets: this,
      x: x + TILE_W / 2,
      y: y + TILE_H / 2,
      duration: STEP_MS,
      ease: "Linear",
      onComplete: () => {
        if (this.scene) this.sprite.setFrame(this.charBase);
      },
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
        fontFamily: FONT_NARROW,
        fontSize: isEmote ? "20px" : "10px",
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

    const bubble = this.scene.add.container(0, -TILE_H - 14, [bg, label]);
    bubble.setDepth(100000);
    this.add(bubble);
    this.bubble = bubble;

    // Pop-in, then auto-dismiss.
    bubble.setScale(0.6);
    this.scene.tweens.add({ targets: bubble, scale: 1, duration: 120, ease: "Back.easeOut" });
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
