import Phaser from "phaser";
import { FONT, COLORS, CURSORS, UI_ATLAS, uiFrame } from "./theme";
import { loadSettings } from "../data/Settings";

export function playUiSound(scene: Phaser.Scene, key: string, volume = 0.4) {
  try {
    if (scene.sound.locked || !loadSettings().soundEnabled) return;
    scene.sound.play(key, { volume });
  } catch {}
}

export function uiImage(
  scene: Phaser.Scene,
  x: number,
  y: number,
  name: string,
): Phaser.GameObjects.Image {
  return scene.add.image(x, y, UI_ATLAS, uiFrame(name));
}

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
  return scene.add.nineslice(
    x,
    y,
    UI_ATLAS,
    uiFrame(name),
    w,
    h,
    left,
    right,
    top,
    bottom,
  );
}

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

export function fitModal(
  scene: Phaser.Scene,
  contentW: number,
  contentH: number,
  pad = 24,
  dimAlpha = 0.78,
): void {
  scene.cameras.main.setBackgroundColor(`rgba(0,0,0,${dimAlpha})`);

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

export function closeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  onClick: () => void,
  opts: CloseButtonOpts = {},
): Phaser.GameObjects.Image {
  const h = opts.size ?? 30;
  const img = uiImage(
    scene,
    x,
    y,
    opts.grey ? "ui-btn-close-grey" : "ui-btn-close",
  )
    .setOrigin(0.5)

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

    this.bg = uiNineslice(scene, 0, 0, tex, w, h, 8).setOrigin(0.5);
    this.label = scene.add
      .text(0, -2, text, {
        fontFamily: FONT,
        fontSize: `${opts.fontSize ?? 16}px`,

        color: COLORS.textDark,
      })
      .setOrigin(0.5)
      .setResolution(4);

    this.add([this.bg, this.label]);
    this.setSize(w, h);

    this.bg.setInteractive({ cursor: CURSORS.pointer });

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
    super(
      scene,
      x,
      y,
      UI_ATLAS,
      uiFrame(checked ? "ui-check-on" : "ui-check-off"),
    );
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

    const track = uiNineslice(
      scene,
      0,
      0,
      "ui-slide-track",
      width,
      16,
      7,
    ).setOrigin(0, 0.5);
    this.fill = uiNineslice(
      scene,
      0,
      0,
      "ui-slide-fill",
      width * this.val,
      16,
      7,
    ).setOrigin(0, 0.5);
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
