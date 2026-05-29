import Phaser from "phaser";

export interface MenuButton {
  container: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
  setText(text: string): void;
  destroy(): void;
}

interface MakeButtonOpts {
  width?: number;
  height?: number;
  onClick: () => void;
}

const FILL_IDLE = 0x222234;
const FILL_HOVER = 0x3a3a55;
const FILL_PRESS = 0x14142a;
const BORDER_IDLE = 0xf0a500;
const BORDER_HOVER = 0xffd24a;
const TEXT_IDLE = "#ffffff";
const TEXT_HOVER = "#ffd24a";

type State = "idle" | "hover" | "press";

export function makeMenuButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  opts: MakeButtonOpts,
): MenuButton {
  const w = opts.width ?? 260;
  const h = opts.height ?? 36;

  const bg = scene.add.graphics();
  const label = scene.add
    .text(0, 0, text, {
      fontFamily: '"Press Start 2P"',
      fontSize: "10px",
      color: TEXT_IDLE,
    })
    .setOrigin(0.5);

  let state: State = "idle";
  let hovering = false;
  let pressed = false;

  const render = () => {
    bg.clear();
    const fill =
      state === "press" ? FILL_PRESS : state === "hover" ? FILL_HOVER : FILL_IDLE;
    const border = state === "idle" ? BORDER_IDLE : BORDER_HOVER;
    bg.fillStyle(fill, 1);
    bg.fillRect(-w / 2, -h / 2, w, h);
    bg.lineStyle(2, border, 1);
    bg.strokeRect(-w / 2, -h / 2, w, h);
    label.setColor(state === "idle" ? TEXT_IDLE : TEXT_HOVER);
  };

  const recompute = () => {
    const next: State = pressed && hovering ? "press" : hovering ? "hover" : "idle";
    if (next !== state) {
      state = next;
      render();
    }
  };
  render();

  const container = scene.add.container(x, y, [bg, label]);
  container.setSize(w, h);
  container.setInteractive(
    new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h),
    Phaser.Geom.Rectangle.Contains,
  );

  // Track cursor only while pointer is genuinely over THIS button. If it's
  // destroyed mid-hover (e.g., scene transition), reset cursor on shutdown
  // so the next scene doesn't inherit a stale "pointer" cursor.
  container.on("pointerover", () => {
    hovering = true;
    scene.input.setDefaultCursor("pointer");
    recompute();
  });
  container.on("pointerout", () => {
    hovering = false;
    pressed = false;
    scene.input.setDefaultCursor("default");
    recompute();
  });
  container.on("pointerdown", () => {
    pressed = true;
    recompute();
  });
  container.on("pointerup", () => {
    const wasPress = pressed && hovering;
    pressed = false;
    recompute();
    if (wasPress) opts.onClick();
  });

  const onShutdown = () => {
    scene.input.setDefaultCursor("default");
  };
  scene.events.once("shutdown", onShutdown);
  scene.events.once("destroy", onShutdown);

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
