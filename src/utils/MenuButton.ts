import Phaser from "phaser";
import { FONT, CURSORS } from "../ui/theme";
import { playUiSound } from "../ui/UIKit";

export interface MenuButton {
  container: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
  setText(text: string): void;
  destroy(): void;
}

interface MakeButtonOpts {
  width?: number;
  height?: number;
  variant?: "blue" | "grey";
  onClick: () => void;
}

// Shared menu button, skinned with the Kenney UI pack nine-slice button art.
// Keeps the original API so every menu scene picks up the new look for free.
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
  container.setInteractive({
    hitArea: new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h),
    hitAreaCallback: Phaser.Geom.Rectangle.Contains,
    cursor: CURSORS.pointer,
  });

  let hovering = false;
  let pressed = false;
  const up = () => {
    bg.setTexture(upTex);
    bg.clearTint();
    label.setY(-2);
  };

  container.on("pointerover", () => {
    hovering = true;
    bg.setTint(0xeaf4ff);
  });
  container.on("pointerout", () => {
    hovering = false;
    pressed = false;
    up();
  });
  container.on("pointerdown", () => {
    pressed = true;
    bg.setTexture(downTex);
    label.setY(0);
    playUiSound(scene, "sfx-click");
  });
  container.on("pointerup", () => {
    const wasPress = pressed && hovering;
    pressed = false;
    up();
    if (wasPress) opts.onClick();
  });

  return {
    container,
    label,
    setText(t: string) {
      label.setText(t);
    },
    destroy() {
      container.destroy();
    },
  };
}
