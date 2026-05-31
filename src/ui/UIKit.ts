import Phaser from "phaser";
import { FONT, COLORS, CURSORS, UI_ATLAS, uiFrame } from "./theme";
import { loadSettings } from "../data/Settings";

// Small widget library skinned with the Kenney "UI pack — adventure". Every
// sprite lives in one atlas (key `UI_ATLAS`); logical "ui-*" names resolve to
// atlas frames via `uiFrame()`. Everything here is plain Phaser GameObjects so
// it drops into any scene (menus, HUD, chat).

/** Play a UI sound, swallowing the "audio not unlocked yet" errors. */
export function playUiSound(scene: Phaser.Scene, key: string, volume = 0.4) {
  try {
    if (scene.sound.locked || !loadSettings().soundEnabled) return;
    scene.sound.play(key, { volume });
  } catch {
    /* audio not ready — ignore */
  }
}

/** An Image of a logical "ui-*" sprite from the adventure atlas. */
export function uiImage(
  scene: Phaser.Scene,
  x: number,
  y: number,
  name: string,
): Phaser.GameObjects.Image {
  return scene.add.image(x, y, UI_ATLAS, uiFrame(name));
}

/** A NineSlice of a logical "ui-*" sprite from the adventure atlas. */
export function uiNineslice(
  scene: Phaser.Scene,
  x: number,
  y: number,
  name: string,
  w: number,
  h: number,
  left: number,
  right = left,
  top = left,
  bottom = left,
): Phaser.GameObjects.NineSlice {
  return scene.add.nineslice(x, y, UI_ATLAS, uiFrame(name), w, h, left, right, top, bottom);
}

/** A nine-sliced panel. Defaults to the dark wood + metal-corner frame, whose
 *  decorative corners are ~18px → inset 20. */
export function panel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  texture = "ui-panel-dark",
): Phaser.GameObjects.NineSlice {
  return uiNineslice(scene, x, y, texture, w, h, 20, 20, 20, 20);
}

/**
 * Make a modal scene fit short / narrow viewports — chiefly mobile landscape,
 * where the screen is too short for a fixed-height panel. Scales the scene's
 * camera so a centred `contentW`×`contentH` panel always fits (never enlarging
 * past 1×), and dims the backdrop via the camera background (screen-space, so it
 * covers fully no matter the zoom). Re-fits on every resize / orientation flip.
 *
 * Scenes that call this should NOT draw their own full-screen dim rectangle —
 * the camera background handles it (a world-space dim would shrink under zoom).
 */
export function fitModal(
  scene: Phaser.Scene,
  contentW: number,
  contentH: number,
  pad = 24,
  dimAlpha = 0.78,
): void {
  scene.cameras.main.setBackgroundColor(`rgba(0,0,0,${dimAlpha})`);
  // The panel was laid out around this point; keep the camera centred on it so
  // an orientation flip while open doesn't drag the panel off to one side.
  const cx0 = scene.scale.width / 2;
  const cy0 = scene.scale.height / 2;
  const apply = () => {
    const w = scene.scale.width;
    const h = scene.scale.height;
    const z = Math.min(1, (w - pad) / contentW, (h - pad) / contentH);
    scene.cameras.main.setZoom(z);
    scene.cameras.main.centerOn(cx0, cy0);
  };
  apply();
  scene.scale.on("resize", apply);
  scene.events.once("shutdown", () => scene.scale.off("resize", apply));
}

export interface CloseButtonOpts {
  size?: number;
  grey?: boolean;
}

/** A ready-made ✕ close button (the adventure pack's `button_*_close` sprite).
 *  Drop it at the top-right corner of a panel and wire `onClick` to close. */
export function closeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  onClick: () => void,
  opts: CloseButtonOpts = {},
): Phaser.GameObjects.Image {
  const h = opts.size ?? 30;
  const img = uiImage(scene, x, y, opts.grey ? "ui-btn-close-grey" : "ui-btn-close")
    .setOrigin(0.5)
    // The close sprite is 48×24 (2:1), so keep that ratio when sizing by height.
    .setDisplaySize(h * 2, h)
    .setInteractive({ cursor: CURSORS.pointer });
  img.on("pointerover", () => img.setTint(0xfff2cc));
  img.on("pointerout", () => img.clearTint());
  img.on("pointerdown", () => {
    img.setTint(0xd8c298);
    playUiSound(scene, "sfx-click");
  });
  img.on("pointerup", () => {
    img.clearTint();
    onClick();
  });
  img.on("pointerupoutside", () => img.clearTint());
  return img;
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
    const tex = opts.variant === "grey" ? "ui-btn-grey" : "ui-btn";

    // The adventure button sprite is 48×24 with ~8px rounded corners → inset 8.
    this.bg = uiNineslice(scene, 0, 0, tex, w, h, 8).setOrigin(0.5);
    this.label = scene.add
      .text(0, -2, text, {
        fontFamily: FONT,
        fontSize: `${opts.fontSize ?? 16}px`,
        // Dark ink reads on the light parchment / slate adventure buttons.
        color: COLORS.textDark,
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

    // No separate pressed sprite in this pack — show hover/press with a warm
    // highlight / darkening tint plus a 1px label nudge.
    this.bg.on("pointerover", () => this.enabled && this.bg.setTint(0xfff2cc));
    this.bg.on("pointerout", () => {
      this.bg.clearTint();
      this.label.setY(-2);
    });
    this.bg.on("pointerdown", () => {
      if (!this.enabled) return;
      this.bg.setTint(0xd8c298);
      this.label.setY(0);
      playUiSound(scene, "sfx-click");
    });
    this.bg.on("pointerup", () => {
      if (!this.enabled) return;
      this.bg.setTint(0xfff2cc);
      this.label.setY(-2);
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
    super(scene, x, y, UI_ATLAS, uiFrame(checked ? "ui-check-on" : "ui-check-off"));
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
    this.setTexture(UI_ATLAS, uiFrame(v ? "ui-check-on" : "ui-check-off"));
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

    const track = uiNineslice(scene, 0, 0, "ui-slide-track", width, 16, 7)
      .setOrigin(0, 0.5);
    this.fill = uiNineslice(scene, 0, 0, "ui-slide-fill", width * this.val, 16, 7)
      .setOrigin(0, 0.5);
    this.handle = uiImage(scene, width * this.val, 0, "ui-slide-handle")
      .setOrigin(0.5)
      .setDisplaySize(26, 26);

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
