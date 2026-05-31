import Phaser from "phaser";
import {
  ANIM,
  IDLE_FRAME_MS,
  WALK_FRAME_MS,
  outfitLayers,
  type Dir,
  type Outfit,
} from "../world/cozyChar";

// A layered CozyValley paper-doll avatar: several 32×32 sprites (hands, body,
// clothes, hair) stacked back-to-front, all showing the same frame so one
// frame index drives the whole character. Owns its own frame-advance timer.
// Used by both Player and Npc; positioning / hop / bob are the parent's job.
export class CozyAvatar extends Phaser.GameObjects.Container {
  private layers: Phaser.GameObjects.Sprite[] = [];
  private kind: "idle" | "walk" = "idle";
  private dir: Dir = "down";
  private flipLeft = false;
  private idx = 0;
  private timer?: Phaser.Time.TimerEvent;
  private timerDelay = 0;

  constructor(scene: Phaser.Scene, outfit: Outfit) {
    super(scene, 0, 0);
    this.setOutfit(outfit);
    scene.add.existing(this);
  }

  // (Re)build the layer sprites for an outfit, preserving the current pose.
  setOutfit(outfit: Outfit) {
    for (const l of this.layers) l.destroy();
    this.layers = [];
    for (const key of outfitLayers(outfit)) {
      if (!key) continue;
      // Origin at the feet (bottom-centre) so a 32px sprite stands on the tile.
      const sprite = this.scene.add.sprite(0, 0, key, 0).setOrigin(0.5, 1);
      this.layers.push(sprite);
      this.add(sprite);
    }
    this.applyFrame();
    this.applyFlip();
    this.ensureTimer();
  }

  // Set the active animation + facing. Resets the frame cursor only when the
  // animation or direction actually changes, so a continuous walk keeps cycling.
  setAnim(kind: "idle" | "walk", dir: Dir, flipLeft: boolean) {
    if (kind !== this.kind || dir !== this.dir) {
      this.kind = kind;
      this.dir = dir;
      this.idx = 0;
    }
    this.flipLeft = flipLeft;
    this.applyFlip();
    this.applyFrame();
    this.ensureTimer();
  }

  private frames(): readonly number[] {
    return ANIM[this.kind][this.dir];
  }

  private applyFrame() {
    const fr = this.frames();
    const f = fr[this.idx % fr.length];
    for (const l of this.layers) l.setFrame(f);
  }

  private applyFlip() {
    const flip = this.dir === "side" && this.flipLeft;
    for (const l of this.layers) l.setFlipX(flip);
  }

  private tick = () => {
    const len = this.frames().length;
    this.idx = (this.idx + 1) % len;
    this.applyFrame();
  };

  private ensureTimer() {
    const delay = this.kind === "walk" ? WALK_FRAME_MS : IDLE_FRAME_MS;
    if (this.timer && this.timerDelay === delay) return;
    this.timer?.remove();
    this.timerDelay = delay;
    this.timer = this.scene.time.addEvent({ delay, loop: true, callback: this.tick });
  }

  destroy(fromScene?: boolean) {
    this.timer?.remove();
    this.timer = undefined;
    super.destroy(fromScene);
  }
}
