import Phaser from "phaser";
import { FONT, COLORS, CURSORS } from "./theme";
import { loadSettings } from "../data/Settings";

// Small widget library skinned with the Kenney UI pack. Everything here is
// plain Phaser GameObjects so it drops into any scene (menus, HUD, chat).

/** Play a UI sound, swallowing the "audio not unlocked yet" errors. */
export function playUiSound(scene: Phaser.Scene, key: string, volume = 0.4) {
  try {
    if (scene.sound.locked || !loadSettings().soundEnabled) return;
    scene.sound.play(key, { volume });
  } catch {
    /* audio not ready — ignore */
  }
}

/** A nine-sliced panel using the rounded Kenney square sprite. */
export function panel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  texture = "ui-panel",
): Phaser.GameObjects.NineSlice {
  return scene.add.nineslice(x, y, texture, undefined, w, h, 20, 20, 20, 20);
}

export interface ButtonOpts {
  width?: number;
  height?: number;
  fontSize?: number;
  variant?: "blue" | "grey";
  onClick?: () => void;
}

export class Button extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.NineSlice;
  private label: Phaser.GameObjects.Text;
  private upTex: string;
  private downTex: string;
  private enabled = true;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    text: string,
    opts: ButtonOpts = {},
  ) {
    super(scene, x, y);
    const w = opts.width ?? 240;
    const h = opts.height ?? 56;
    this.upTex = opts.variant === "grey" ? "ui-btn-grey" : "ui-btn";
    this.downTex = opts.variant === "grey" ? "ui-btn-grey-down" : "ui-btn-down";

    // The depth/gloss sprites carry a faux 3D bottom edge, so the bottom inset
    // is a touch larger than the others to keep corners from stretching.
    this.bg = scene.add
      .nineslice(0, 0, this.upTex, undefined, w, h, 28, 28, 22, 30)
      .setOrigin(0.5);
    this.label = scene.add
      .text(0, -3, text, {
        fontFamily: FONT,
        fontSize: `${opts.fontSize ?? 16}px`,
        color: COLORS.text,
      })
      .setOrigin(0.5)
      .setResolution(4);

    this.add([this.bg, this.label]);
    this.setSize(w, h);
    // Input lives on the nineslice, not the container: a Container has no Origin
    // component, so making it interactive feeds Phaser an undefined displayOrigin
    // and the hit area shrinks to the centre. The nineslice's default hit area
    // already spans its full size.
    this.bg.setInteractive({ cursor: CURSORS.pointer });

    this.bg.on("pointerover", () => this.enabled && this.bg.setTint(0xeaf4ff));
    this.bg.on("pointerout", () => {
      this.bg.clearTint();
      this.bg.setTexture(this.upTex);
    });
    this.bg.on("pointerdown", () => {
      if (!this.enabled) return;
      this.bg.setTexture(this.downTex);
      this.label.setY(0);
      playUiSound(scene, "sfx-click");
    });
    this.bg.on("pointerup", () => {
      if (!this.enabled) return;
      this.bg.setTexture(this.upTex);
      this.label.setY(-3);
      opts.onClick?.();
    });

    scene.add.existing(this);
  }

  setEnabled(v: boolean): this {
    this.enabled = v;
    this.setAlpha(v ? 1 : 0.5);
    return this;
  }

  setText(t: string): this {
    this.label.setText(t);
    return this;
  }
}

export class Checkbox extends Phaser.GameObjects.Image {
  private checked: boolean;
  private onChange?: (v: boolean) => void;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    checked: boolean,
    onChange?: (v: boolean) => void,
  ) {
    super(scene, x, y, checked ? "ui-check-on" : "ui-check-off");
    this.checked = checked;
    this.onChange = onChange;
    this.setOrigin(0.5).setDisplaySize(40, 40);
    this.setInteractive({ cursor: CURSORS.pointer });
    this.on("pointerdown", () => this.toggle());
    scene.add.existing(this);
  }

  toggle() {
    this.set(!this.checked);
    playUiSound(this.scene, "sfx-switch");
  }

  set(v: boolean): this {
    this.checked = v;
    this.setTexture(v ? "ui-check-on" : "ui-check-off");
    this.setDisplaySize(40, 40);
    this.onChange?.(v);
    return this;
  }

  get value(): boolean {
    return this.checked;
  }
}

export class Slider extends Phaser.GameObjects.Container {
  private fill: Phaser.GameObjects.NineSlice;
  private handle: Phaser.GameObjects.Image;
  private trackW: number;
  private val: number;
  private onChange?: (v: number) => void;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    value: number,
    onChange?: (v: number) => void,
  ) {
    super(scene, x, y);
    this.trackW = width;
    this.val = Phaser.Math.Clamp(value, 0, 1);
    this.onChange = onChange;

    const track = scene.add
      .nineslice(0, 0, "ui-slide-track", undefined, width, 16, 8, 8, 0, 0)
      .setOrigin(0, 0.5);
    this.fill = scene.add
      .nineslice(0, 0, "ui-slide-fill", undefined, width * this.val, 16, 8, 8, 0, 0)
      .setOrigin(0, 0.5);
    this.handle = scene.add
      .image(width * this.val, 0, "ui-slide-handle")
      .setOrigin(0.5)
      .setDisplaySize(20, 28);

    this.add([track, this.fill, this.handle]);

    this.setSize(width, 28);
    this.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(0, -14, width, 28),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      cursor: CURSORS.pointer,
    });

    const apply = (pointer: Phaser.Input.Pointer) => {
      const lx = pointer.x - this.x;
      this.setValue(Phaser.Math.Clamp(lx / this.trackW, 0, 1));
    };
    this.on("pointerdown", (p: Phaser.Input.Pointer) => {
      this.dragging = true;
      apply(p);
      playUiSound(scene, "sfx-tap", 0.25);
    });
    scene.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (this.dragging && p.isDown) apply(p);
    });
    scene.input.on("pointerup", () => (this.dragging = false));

    scene.add.existing(this);
  }

  private dragging = false;

  setValue(v: number): this {
    this.val = Phaser.Math.Clamp(v, 0, 1);
    this.fill.setSize(Math.max(1, this.trackW * this.val), 16);
    this.handle.setX(this.trackW * this.val);
    this.onChange?.(this.val);
    return this;
  }

  get value(): number {
    return this.val;
  }
}
