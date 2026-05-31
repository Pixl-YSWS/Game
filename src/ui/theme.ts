// Central place for fonts, colours and cursors so the whole game shares one
// look. Body text uses the bundled Kenney Future family; only panel/scene
// titles use the Pixelify Sans web font (loaded from index.html).

/** Primary UI font (all-caps blocky). Used everywhere via Phaser text styles. */
export const FONT = "Kenney Future";
/** Condensed variant — handy for chat / dialogue where line length matters. */
export const FONT_NARROW = "Kenney Future Narrow";
/** Title font — Pixelify Sans. Reserved for scene/panel headings only. */
export const FONT_TITLE = "Pixelify Sans";
/** Chat / small-body font — Monocraft (a Minecraft look-alike), falling back
 *  to Pixelify Sans until Monocraft.ttf is added to public/assets/fonts.
 *  Used where the blocky all-caps Kenney font is too dense to read small. */
export const FONT_CHAT = '"Monocraft", "Pixelify Sans", sans-serif';
/** System emoji font stack — for item glyphs (Kenney has no emoji coverage). */
export const FONT_EMOJI =
  '"Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif';

// Shared palette (hex strings for Phaser text, numbers for fills).
export const COLORS = {
  text: "#ffffff",
  textDim: "#c9d4e3",
  accent: "#ffd166",
  good: "#7bdc8b",
  bad: "#ff6b6b",
  panel: 0x1b2233,
  stroke: "#0a0f1c",
} as const;

const CURSOR_BASE = "/assets/kenney_cursor-pixel-pack/Tiles";

// How much to enlarge the 16×16 cursor art. CSS can't scale a cursor image,
// so `buildCursors()` rasterises an upscaled copy to a data URL at boot.
export const CURSOR_SCALE = 3;

// Source art + hotspot (in native 16px pixels). `buildCursors` fills the
// `css` strings with upscaled data URLs; until then these 16px fallbacks work.
const CURSOR_SRC = {
  default: { file: "tile_0026.png", hotX: 1, hotY: 1, fallback: "auto" },
  pointer: { file: "tile_0137.png", hotX: 4, hotY: 1, fallback: "pointer" },
} as const;

// CSS cursor strings for Phaser's input system (mutated by buildCursors).
export const CURSORS = {
  default: `url('${CURSOR_BASE}/${CURSOR_SRC.default.file}') 1 1, auto`,
  pointer: `url('${CURSOR_BASE}/${CURSOR_SRC.pointer.file}') 4 1, pointer`,
};

// Upscale one 16px cursor to a crisp (nearest-neighbour) data-URL cursor
// string with a scale-adjusted hotspot.
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
        ctx.imageSmoothingEnabled = false; // keep pixels crisp
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const url = c.toDataURL("image/png");
        resolve(`url(${url}) ${src.hotX * scale} ${src.hotY * scale}, ${src.fallback}`);
      } catch {
        resolve(fallback);
      }
    };
    img.onerror = () => resolve(fallback);
    img.src = `${CURSOR_BASE}/${src.file}`;
  });
}

/**
 * Rasterise enlarged cursors and apply them globally. Mutates CURSORS (so
 * Phaser hover cursors pick up the bigger pointer) and injects a stylesheet
 * setting the page/canvas default cursor. Call once before the game boots.
 */
export async function buildCursors(scale = CURSOR_SCALE): Promise<void> {
  try {
    const [def, ptr] = await Promise.all([
      upscaleCursor(CURSOR_SRC.default, scale),
      upscaleCursor(CURSOR_SRC.pointer, scale),
    ]);
    CURSORS.default = def;
    CURSORS.pointer = ptr;

    // Default cursor for the page + canvas. No !important so Phaser's inline
    // hover cursor (the pointer) still wins when over an interactive object.
    const style = document.createElement("style");
    style.textContent = `body, #game-container canvas { cursor: ${def}; }`;
    document.head.appendChild(style);
  } catch {
    // Keep the 16px fallbacks.
  }
}

/**
 * Load every UI font before the game boots so the very first text rendered
 * (the BootScene loading label) already uses them — otherwise Phaser caches
 * glyphs in the fallback font at the wrong metrics and centred text ends up
 * mis-aligned.
 */
export async function preloadFonts(): Promise<void> {
  if (!("fonts" in document)) return;
  // Monocraft is optional (added by the user); load it best-effort so a missing
  // file never blocks the others — chat just falls back to Pixelify Sans.
  (document as Document).fonts.load(`16px "Monocraft"`).catch(() => {});
  try {
    await Promise.all([
      (document as Document).fonts.load(`16px "${FONT}"`),
      (document as Document).fonts.load(`16px "${FONT_NARROW}"`),
      (document as Document).fonts.load(`400 16px "${FONT_TITLE}"`),
      (document as Document).fonts.load(`700 16px "${FONT_TITLE}"`),
    ]);
    // Wait for any in-flight font loads kicked off by the stylesheet, too.
    await (document as Document).fonts.ready;
  } catch {
    // Non-fatal: text just falls back to a system font.
  }
}
