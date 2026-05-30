import Phaser from "phaser";
import { FONT, CURSORS } from "../ui/theme";
import { playUiSound } from "../ui/UIKit";

export interface MenuButton {
  container: Phaser.GameObjects.Container;
  // The actual interactive game object (the nineslice background). Input lives
  // here, not on the container — a Container has no Origin component, so making
  // it interactive gives Phaser an `undefined` displayOrigin and the hit test
  // collapses to a tiny region near the centre.
  hit: Phaser.GameObjects.GameObject;
  label: Phaser.GameObjects.Text;
  setText(text: string): void;
  setFocused(v: boolean): void;
  // Swap the click handler (used by recycled list rows).
  setOnClick(fn: () => void): void;
  // Disable/enable: dims the button and ignores clicks while disabled.
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

// Shared menu button, skinned with the Kenney UI pack nine-slice button art.
// Clickable by mouse AND keyboard (see attachMenuNav).
export function makeMenuButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  opts: MakeButtonOpts,
): MenuButton {
  const w = opts.width ?? 268;
  const h = opts.height ?? 54;
  const upTex = opts.variant === "grey" ? "ui-btn-grey" : "ui-btn";
  const downTex = opts.variant === "grey" ? "ui-btn-grey-down" : "ui-btn-down";

  const bg = scene.add
    .nineslice(0, 0, upTex, undefined, w, h, 22, 22, 16, 20)
    .setOrigin(0.5);
  const fontSize = Phaser.Math.Clamp(Math.floor(h * 0.3), 11, 16);
  const label = scene.add
    .text(0, -2, text, { fontFamily: FONT, fontSize: `${fontSize}px`, color: "#ffffff" })
    .setOrigin(0.5)
    .setResolution(4);

  const container = scene.add.container(x, y, [bg, label]);
  container.setSize(w, h);
  // Input lives on the nineslice (it has an Origin, so the hit test is correct
  // across the whole button); the default hit area already covers its full size.
  bg.setInteractive({ cursor: CURSORS.pointer });

  let hovering = false;
  let pressed = false;
  let focused = false;
  let enabled = true;
  let onClick = opts.onClick;

  const render = () => {
    bg.setTexture(pressed ? downTex : upTex);
    if (focused) bg.setTint(0xffe08a);
    else if (hovering) bg.setTint(0xeaf4ff);
    else bg.clearTint();
    container.setScale(focused ? 1.05 : 1);
    container.setAlpha(enabled ? 1 : 0.5);
    label.setY(pressed ? 0 : -2);
  };

  const fire = () => {
    if (enabled) onClick();
  };

  bg.on("pointerover", () => { hovering = true; render(); });
  bg.on("pointerout", () => { hovering = false; pressed = false; render(); });
  bg.on("pointerdown", () => {
    pressed = true;
    render();
    playUiSound(scene, "sfx-click");
  });
  // A pointerup ON the object means it was released over it, so a press that
  // started here is a real click — no fragile "hovering" gate (that was the
  // bug: the first click before any mouse-move was being dropped).
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

// Wire up keyboard navigation for a vertical list of menu buttons: Up/Down
// (or W/S) move the highlight, Enter/Space activate it, and mouse hover syncs
// the highlight so the two input methods don't fight.
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
