import Phaser from "phaser";
import { FONT, CURSORS, COLORS } from "../ui/theme";
import { playUiSound, uiNineslice } from "../ui/UIKit";

export interface MenuButton {
  container: Phaser.GameObjects.Container;
  hit: Phaser.GameObjects.GameObject;
  label: Phaser.GameObjects.Text;
  setText(text: string): void;
  setFocused(v: boolean): void;

  setOnClick(fn: () => void): void;

  setEnabled(v: boolean): void;
  trigger(): void;
  destroy(): void;
}

interface MakeButtonOpts {
  width?: number;
  height?: number;
  variant?: "blue" | "grey";
  onClick: () => void;
}

export function makeMenuButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  opts: MakeButtonOpts,
): MenuButton {
  const w = opts.width ?? 268;
  const h = opts.height ?? 54;
  const tex = opts.variant === "grey" ? "ui-btn-grey" : "ui-btn";

  const bg = uiNineslice(scene, 0, 0, tex, w, h, 8).setOrigin(0.5);
  const fontSize = Phaser.Math.Clamp(Math.floor(h * 0.3), 11, 16);
  const label = scene.add
    .text(0, -2, text, {
      fontFamily: FONT,
      fontSize: `${fontSize}px`,
      color: COLORS.textDark,
    })
    .setOrigin(0.5)
    .setResolution(4);

  const container = scene.add.container(x, y, [bg, label]);
  container.setSize(w, h);

  bg.setInteractive({ cursor: CURSORS.pointer });

  let hovering = false;
  let pressed = false;
  let focused = false;
  let enabled = true;
  let onClick = opts.onClick;

  const render = () => {
    if (pressed) bg.setTint(0xd8c298);
    else if (focused) bg.setTint(0xffe08a);
    else if (hovering) bg.setTint(0xfff2cc);
    else bg.clearTint();
    container.setScale(focused ? 1.05 : 1);
    container.setAlpha(enabled ? 1 : 0.5);
    label.setY(pressed ? 0 : -2);
  };

  const fire = () => {
    if (enabled) onClick();
  };

  bg.on("pointerover", () => {
    hovering = true;
    render();
  });
  bg.on("pointerout", () => {
    hovering = false;
    pressed = false;
    render();
  });
  bg.on("pointerdown", () => {
    pressed = true;
    render();
    playUiSound(scene, "sfx-click");
  });

  bg.on("pointerup", () => {
    if (!pressed) return;
    pressed = false;
    render();
    fire();
  });

  return {
    container,
    hit: bg,
    label,
    setText(t: string) {
      label.setText(t);
    },
    setFocused(v: boolean) {
      focused = v;
      render();
    },
    setOnClick(fn: () => void) {
      onClick = fn;
    },
    setEnabled(v: boolean) {
      enabled = v;
      render();
    },
    trigger() {
      playUiSound(scene, "sfx-click");
      fire();
    },
    destroy() {
      container.destroy();
    },
  };
}

export function attachMenuNav(scene: Phaser.Scene, buttons: MenuButton[]) {
  if (buttons.length === 0) return;
  let idx = 0;
  const setFocus = (n: number, sound = true) => {
    buttons[idx].setFocused(false);
    idx = (n + buttons.length) % buttons.length;
    buttons[idx].setFocused(true);
    if (sound) playUiSound(scene, "sfx-tap", 0.25);
  };
  buttons[idx].setFocused(true);

  buttons.forEach((b, i) => {
    b.hit.on("pointerover", () => {
      if (i !== idx) setFocus(i, false);
    });
  });

  const kb = scene.input.keyboard;
  if (!kb) return;
  kb.on("keydown-UP", () => setFocus(idx - 1));
  kb.on("keydown-W", () => setFocus(idx - 1));
  kb.on("keydown-DOWN", () => setFocus(idx + 1));
  kb.on("keydown-S", () => setFocus(idx + 1));
  kb.on("keydown-ENTER", () => buttons[idx].trigger());
  kb.on("keydown-SPACE", () => buttons[idx].trigger());
}
