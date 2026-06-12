export const FONT = '"Monocraft", "Pixelify Sans", monospace';

export const FONT_NARROW = '"Monocraft", "Pixelify Sans", sans-serif';

export const FONT_TITLE = "Pixelify Sans";

export const FONT_CHAT = '"Monocraft", "Pixelify Sans", sans-serif';
export const FONT_DIALOUG = '"Monocraft", "Pixelify Sans", sans-serif';

export const FONT_EMOJI =
  '"Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif';

export const COLORS = {
  text: "#f4e3c2",
  textDim: "#c9b18c",

  textDark: "#2b1d12",
  accent: "#ffd166",
  good: "#7bdc8b",
  bad: "#ff6b6b",
  panel: 0x2b1d12,
  stroke: "#17100a",
} as const;

export const UI_ATLAS = "ui-adv";

const UI_FRAME: Record<string, string> = {
  "ui-panel": "panel_brownimg.png",
  "ui-panel-dark": "panel_brown_dark_corners_aimg.png",
  "ui-btn": "button_brownimg.png",
  "ui-btn-down": "button_brownimg.png",
  "ui-btn-grey": "button_greyimg.png",
  "ui-btn-grey-down": "button_greyimg.png",
  "ui-btn-close": "button_brown_closeimg.png",
  "ui-btn-close-grey": "button_grey_closeimg.png",
  "ui-check-off": "checkbox_brown_emptyimg.png",
  "ui-check-on": "checkbox_brown_checkedimg.png",
  "ui-slide-track": "panel_brown_darkimg.png",
  "ui-slide-fill": "panel_brownimg.png",
  "ui-slide-handle": "round_brownimg.png",
  "ui-round": "round_brownimg.png",
  "ui-round-down": "round_brown_darkimg.png",
};

export function uiFrame(name: string): string {
  return UI_FRAME[name] ?? name;
}

export const EMOTE_ATLAS = "emotes";

const CURSOR_BASE = "/assets/kenney_cursor-pixel-pack/Tiles";

export const CURSOR_SCALE = 3;

const CURSOR_SRC = {
  default: { file: "tile_0026.png", hotX: 1, hotY: 1, fallback: "auto" },
  pointer: { file: "tile_0137.png", hotX: 4, hotY: 1, fallback: "pointer" },
} as const;

export const CURSORS = {
  default: `url('${CURSOR_BASE}/${CURSOR_SRC.default.file}') 1 1, auto`,
  pointer: `url('${CURSOR_BASE}/${CURSOR_SRC.pointer.file}') 4 1, pointer`,
};

function upscaleCursor(
  src: { file: string; hotX: number; hotY: number; fallback: string },
  scale: number,
): Promise<string> {
  return new Promise((resolve) => {
    const fallback = `url('${CURSOR_BASE}/${src.file}') ${src.hotX} ${src.hotY}, ${src.fallback}`;
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = img.width * scale;
        c.height = img.height * scale;
        const ctx = c.getContext("2d");
        if (!ctx) return resolve(fallback);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const url = c.toDataURL("image/png");
        resolve(
          `url(${url}) ${src.hotX * scale} ${src.hotY * scale}, ${src.fallback}`,
        );
      } catch {
        resolve(fallback);
      }
    };
    img.onerror = () => resolve(fallback);
    img.src = `${CURSOR_BASE}/${src.file}`;
  });
}

export async function buildCursors(scale = CURSOR_SCALE): Promise<void> {
  try {
    const [def, ptr] = await Promise.all([
      upscaleCursor(CURSOR_SRC.default, scale),
      upscaleCursor(CURSOR_SRC.pointer, scale),
    ]);
    CURSORS.default = def;
    CURSORS.pointer = ptr;

    const style = document.createElement("style");
    style.textContent = `body, #game-container canvas { cursor: ${def}; }`;
    document.head.appendChild(style);
  } catch {}
}

export async function preloadFonts(): Promise<void> {
  if (!("fonts" in document)) return;
  try {
    await Promise.all([
      (document as Document).fonts.load(`16px "${FONT}"`),
      (document as Document).fonts.load(`16px "${FONT_NARROW}"`),
      (document as Document).fonts.load(`400 16px "${FONT_TITLE}"`),
      (document as Document).fonts.load(`700 16px "${FONT_TITLE}"`),

      (document as Document).fonts.load(`16px "Monocraft"`).catch(() => {}),
    ]);

    await (document as Document).fonts.ready;
  } catch {}
}
