import Phaser from "phaser";
import { cartToIso, TILE_W, TILE_H } from "../utils/IsoUtils";
import type { NpcDef, MapDef } from "../types/map";
import { FONT, CURSORS, EMOTE_ATLAS } from "../ui/theme";
import { emoteFrame } from "../ui/emotes";
import {
  texNpcChar,
  NPC_CHARS,
  ANIM,
  IDLE_FRAME_MS,
  WALK_FRAME_MS,
  type Dir,
} from "../world/cozyChar";

const NPC_CHAR_LOOKUP: Record<string, number> = {
  villager_quill: 1,
  villager_mara: 2,
  merchant_oda: 3,
  curator_pip: 4,
  house_innkeeper: 5,
};

function npcCharIndex(id: string): number {
  return NPC_CHAR_LOOKUP[id] ?? 1;
}

// How far an NPC will ever stray from its spawn post (Manhattan tiles). Large
// so villagers roam across the whole village rather than fidget on the spot.
const HOME_RADIUS = 40;

export class Npc extends Phaser.GameObjects.Container {
  public readonly def: NpcDef;
  // Live tile the NPC stands on (updates as it wanders).
  public cx: number;
  public cy: number;
  private readonly homeCx: number;
  private readonly homeCy: number;
  private mapDef: MapDef;

  private nameTag: Phaser.GameObjects.Text;
  private charSprite: Phaser.GameObjects.Sprite;
  private animTimer?: Phaser.Time.TimerEvent;
  private wanderTimer?: Phaser.Time.TimerEvent;
  private moveTween?: Phaser.Tweens.Tween;

  private dir: Dir = "down";
  private facingLeft = false;
  private isMoving = false;
  // Busy chatting with another NPC — paused and not eligible for a new chat.
  private busy = false;
  private walkDir: [number, number] = [0, 0];
  private stepsLeft = 0;

  // Shared with sibling NPCs so they don't pile onto the same tile.
  private occupied: Set<string>;

  constructor(
    scene: Phaser.Scene,
    def: NpcDef,
    mapDef: MapDef,
    occupied?: Set<string>,
  ) {
    const { x, y } = cartToIso(def.cx, def.cy);
    super(scene, x + TILE_W / 2, y + TILE_H / 2);
    this.def = def;
    this.cx = def.cx;
    this.cy = def.cy;
    this.homeCx = def.cx;
    this.homeCy = def.cy;
    this.mapDef = mapDef;
    this.occupied = occupied ?? new Set<string>();
    this.occupied.add(`${this.cx},${this.cy}`);

    const shadow = scene.add.ellipse(
      0,
      5,
      TILE_W * 0.7,
      TILE_H * 0.4,
      0x000000,
      0.25,
    );

    // Hand-authored maps pick the character directly (via the tileset they drew
    // the NPC with); fall back to the id lookup for procedurally-placed NPCs.
    const charN =
      def.sprite >= 1 && def.sprite <= NPC_CHARS
        ? def.sprite
        : npcCharIndex(def.id);
    this.charSprite = scene.add
      .sprite(0, TILE_H / 2 + 3, texNpcChar(charN), ANIM.idle.down[0])
      .setOrigin(0.5, 1);

    this.nameTag = scene.add
      .text(0, -TILE_H, def.name, {
        fontSize: "16px",
        fontFamily: FONT,
        color: "#ffd24a",
        stroke: "#000000",
        strokeThickness: 5,
      })
      .setOrigin(0.5, 1)
      .setResolution(4)
      .setScale(0.34);

    this.add([shadow, this.charSprite, this.nameTag]);
    scene.add.existing(this);
    this.setDepth(def.cy + 1.5);

    this.setSize(TILE_W, TILE_H + 28);
    this.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(
        -TILE_W / 2,
        -TILE_H - 16,
        TILE_W,
        TILE_H + 28,
      ),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      cursor: CURSORS.pointer,
    });

    this.playAnim("idle");
    this.scheduleWander();
  }

  private frames(kind: "idle" | "walk"): readonly number[] {
    return ANIM[kind][this.dir];
  }

  private playAnim(kind: "idle" | "walk") {
    this.animTimer?.remove(false);
    const frames = this.frames(kind);
    this.charSprite.setFlipX(this.dir === "side" && this.facingLeft);
    this.charSprite.setFrame(frames[0]);
    let i = 0;
    this.animTimer = this.scene.time.addEvent({
      delay: kind === "walk" ? WALK_FRAME_MS : IDLE_FRAME_MS,
      loop: true,
      callback: () => {
        i = (i + 1) % frames.length;
        this.charSprite.setFrame(frames[i]);
      },
    });
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

  private scheduleWander() {
    // Long, varied rests so villagers loiter at their post instead of pacing.
    this.wanderTimer = this.scene.time.addEvent({
      delay: 5000 + Math.random() * 8000,
      callback: () => this.wander(),
    });
  }

  private wander() {
    if (this.isMoving || this.busy || !this.scene) return;

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
      if (this.canMoveTo(this.cx + dx, this.cy + dy)) {
        this.walkDir = [dx, dy];
        // Long strolls so villagers actually cross the village.
        this.stepsLeft = 4 + Math.floor(Math.random() * 8);
        this.setDirection(dx, dy);
        this.playAnim("idle");
        // Brief pause to turn before stepping off, like the player does.
        this.scene.time.delayedCall(180, () => this.stepStroll(true));
        return;
      }
    }

    this.scheduleWander();
  }

  private canMoveTo(cx: number, cy: number): boolean {
    if (cx < 0 || cy < 0 || cx >= this.mapDef.cols || cy >= this.mapDef.rows)
      return false;
    // Stay near the spawn post so shop/quest NPCs don't wander off.
    if (
      Math.abs(cx - this.homeCx) + Math.abs(cy - this.homeCy) >
      HOME_RADIUS
    )
      return false;
    const g = this.mapDef.groundLayer[cy]?.[cx];
    if (g === undefined || !this.mapDef.walkableGround.has(g)) return false;
    const d = this.mapDef.decoLayer[cy]?.[cx];
    if (d !== undefined && d >= 0 && this.mapDef.solidDeco.has(d)) return false;
    const key = `${cx},${cy}`;
    if (this.occupied.has(key) && key !== `${this.cx},${this.cy}`) return false;
    return true;
  }

  // Walk one tile in walkDir, then chain to the next until the stroll ends.
  private stepStroll(first: boolean) {
    if (!this.scene) return;
    const [dx, dy] = this.walkDir;
    const nc = this.cx + dx;
    const nr = this.cy + dy;
    if (this.stepsLeft <= 0 || !this.canMoveTo(nc, nr)) {
      this.endStroll();
      return;
    }
    this.stepsLeft--;
    this.isMoving = true;

    const oldKey = `${this.cx},${this.cy}`;
    const newKey = `${nc},${nr}`;
    this.occupied.add(newKey);
    this.cx = nc;
    this.cy = nr;

    if (first) this.playAnim("walk");

    const dest = cartToIso(nc, nr);
    this.moveTween = this.scene.tweens.add({
      targets: this,
      x: dest.x + TILE_W / 2,
      y: dest.y + TILE_H / 2,
      duration: 220 + Math.random() * 80,
      ease: "Linear",
      onUpdate: () => {
        this.setDepth(Math.floor(this.y / TILE_H) + 1.5);
      },
      onComplete: () => {
        this.occupied.delete(oldKey);
        this.stepStroll(false);
      },
    });
  }

  private endStroll() {
    this.isMoving = false;
    this.setDepth(this.cy + 1.5);
    this.playAnim("idle");
    this.scheduleWander();
  }

  /** Eligible to start a chat: standing idle and not already chatting. */
  isAvailable(): boolean {
    return !this.busy && !this.isMoving;
  }

  /**
   * Pause to "chat" with a neighbour: stop wandering, turn to face them, and
   * resume roaming after `durationMs`. Should only be called while idle.
   */
  startChat(towardCx: number, towardCy: number, durationMs: number) {
    if (!this.scene) return;
    this.busy = true;
    this.wanderTimer?.remove(false);
    this.wanderTimer = undefined;
    const dx = towardCx - this.cx;
    const dy = towardCy - this.cy;
    if (dx !== 0 && Math.abs(dx) >= Math.abs(dy)) this.setDirection(dx, 0);
    else if (dy !== 0) this.setDirection(0, dy);
    this.playAnim("idle");
    this.scene.time.delayedCall(durationMs, () => {
      this.busy = false;
      if (this.scene) this.scheduleWander();
    });
  }

  /** Pop a little emote bubble above the NPC's head (used during chats). */
  showEmote(key: string) {
    if (!this.scene) return;
    const bubble = this.scene.add
      .image(this.x, this.y - TILE_H * 1.4, EMOTE_ATLAS, emoteFrame(key))
      .setDepth(100000)
      .setDisplaySize(14, 14);
    this.scene.tweens.add({
      targets: bubble,
      y: bubble.y - 6,
      alpha: { from: 1, to: 0 },
      duration: 1300,
      delay: 600,
      ease: "Quad.easeOut",
      onComplete: () => bubble.destroy(),
    });
  }

  /** Snap to a saved tile when restoring a village's last-known layout. */
  placeAt(cx: number, cy: number) {
    if (cx < 0 || cy < 0 || cx >= this.mapDef.cols || cy >= this.mapDef.rows)
      return;
    this.occupied.delete(`${this.cx},${this.cy}`);
    this.cx = cx;
    this.cy = cy;
    this.occupied.add(`${cx},${cy}`);
    const { x, y } = cartToIso(cx, cy);
    this.setPosition(x + TILE_W / 2, y + TILE_H / 2);
    this.setDepth(cy + 1.5);
  }

  destroy(fromScene?: boolean) {
    this.animTimer?.remove(false);
    this.wanderTimer?.remove(false);
    this.moveTween?.remove();
    this.occupied.delete(`${this.cx},${this.cy}`);
    super.destroy(fromScene);
  }
}
