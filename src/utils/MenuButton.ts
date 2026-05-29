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
const BORDER_IDLE = 0xf0a500;
const BORDER_HOVER = 0xffd24a;
const TEXT_IDLE = "#ffffff";
const TEXT_HOVER = "#ffd24a";

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
  const draw = (fill: number, border: number) => {
    bg.clear();
    bg.fillStyle(fill, 1);
    bg.fillRect(-w / 2, -h / 2, w, h);
    bg.lineStyle(2, border, 1);
    bg.strokeRect(-w / 2, -h / 2, w, h);
  };
  draw(FILL_IDLE, BORDER_IDLE);

  const label = scene.add
    .text(0, 0, text, {
      fontFamily: '"Press Start 2P"',
      fontSize: "10px",
      color: TEXT_IDLE,
    })
    .setOrigin(0.5);

  const container = scene.add.container(x, y, [bg, label]);
  container.setSize(w, h);
  container.setInteractive(
    new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h),
    Phaser.Geom.Rectangle.Contains,
  );
  container.on("pointerover", () => {
    draw(FILL_HOVER, BORDER_HOVER);
    label.setColor(TEXT_HOVER);
    scene.input.setDefaultCursor("pointer");
  });
  container.on("pointerout", () => {
    draw(FILL_IDLE, BORDER_IDLE);
    label.setColor(TEXT_IDLE);
    scene.input.setDefaultCursor("default");
  });
  container.on("pointerdown", () => {
    draw(BORDER_IDLE, BORDER_HOVER);
  });
  container.on("pointerup", () => {
    draw(FILL_HOVER, BORDER_HOVER);
    opts.onClick();
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
