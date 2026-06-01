export const FRAME_W = 32;
export const FRAME_H = 32;
export const SHEET_COLS = 5;

export type Dir = "down" | "side" | "up";

const frame = (row: number, col: number) => row * SHEET_COLS + col;

export const ANIM = {
  idle: {
    up: [frame(0, 0), frame(0, 1), frame(0, 2), frame(0, 3)],
    side: [frame(1, 0), frame(1, 1), frame(1, 2), frame(1, 3)],
    down: [frame(2, 0), frame(2, 1), frame(2, 2), frame(2, 3)],
  },
  walk: {
    up: [frame(3, 0), frame(3, 1), frame(3, 2)],
    side: [frame(4, 0), frame(4, 1), frame(4, 2)],
    down: [frame(5, 0), frame(5, 1), frame(5, 2)],
  },
} as const;

export const IDLE_FRAME_MS = 260;
export const WALK_FRAME_MS = 150;

export const NUM_BODY = 3;
export const NUM_HAIR = 6;
export const NUM_TOP = 6;
export const NUM_BOTTOM = 6;

export interface Outfit {
  body: number;
  hair: number;
  top: number;
  bottom: number;
}

export const PRESET_OUTFITS: Outfit[] = [
  { body: 1, hair: 1, top: 1, bottom: 1 },
  { body: 2, hair: 3, top: 4, bottom: 2 },
  { body: 3, hair: 5, top: 2, bottom: 5 },
  { body: 1, hair: 2, top: 6, bottom: 3 },
  { body: 2, hair: 6, top: 3, bottom: 6 },
];

export function defaultOutfitIndex(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % PRESET_OUTFITS.length;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v | 0));
export function clampOutfit(o: Outfit): Outfit {
  return {
    body: clamp(o.body, 1, NUM_BODY),
    hair: clamp(o.hair, 0, NUM_HAIR),
    top: clamp(o.top, 1, NUM_TOP),
    bottom: clamp(o.bottom, 1, NUM_BOTTOM),
  };
}

const OUTFIT_RE = /^cv1:b([1-3])h([0-6])t([1-6])o([1-6])$/;

/** True if `s` is a well-formed outfit descriptor. */
export function isValidSkin(s: unknown): s is string {
  return typeof s === "string" && OUTFIT_RE.test(s);
}

export function encodeOutfit(o: Outfit): string {
  const c = clampOutfit(o);
  return `cv1:b${c.body}h${c.hair}t${c.top}o${c.bottom}`;
}

export function decodeOutfit(s: string): Outfit | null {
  const m = OUTFIT_RE.exec(s);
  if (!m) return null;
  return { body: +m[1], hair: +m[2], top: +m[3], bottom: +m[4] };
}

export const texBody = (n: number) => `cv-body-${n}`;
export const texHandBack = (n: number) => `cv-handback-${n}`;
export const texHandFront = (n: number) => `cv-handfront-${n}`;
export const texHair = (n: number) => `cv-hair-${n}`;
export const texTop = (n: number) => `cv-top-${n}`;
export const texBottom = (n: number) => `cv-bottom-${n}`;

export const NPC_CHARS = 9;
const NPC_CHAR_DIR =
  "assets/CozyValley_Premium_1.3/CozyValley_Premium_1.3/Characters/-- Pre-assembled Characters";
export const texNpcChar = (n: number) => `cv-npc-${n}`;
export function npcCharSheetSpecs(): SheetSpec[] {
  const specs: SheetSpec[] = [];
  for (let n = 1; n <= NPC_CHARS; n++) {
    specs.push({ key: texNpcChar(n), path: `${NPC_CHAR_DIR}/char${n}.png` });
  }
  return specs;
}

const BASE_DIR = "assets/CozyValley_Basic_1.0/CozyValley_Basic_1.0/Characters";
export interface SheetSpec {
  key: string;
  path: string;
}
export function characterSheetSpecs(): SheetSpec[] {
  const specs: SheetSpec[] = [];
  for (let n = 1; n <= NUM_BODY; n++) {
    specs.push({ key: texBody(n), path: `${BASE_DIR}/Base/Base${n}_body.png` });
    specs.push({
      key: texHandBack(n),
      path: `${BASE_DIR}/Base/Base${n}_hand_back.png`,
    });
    specs.push({
      key: texHandFront(n),
      path: `${BASE_DIR}/Base/Base${n}_hand_front.png`,
    });
  }
  for (let h = 1; h <= NUM_HAIR; h++)
    specs.push({
      key: texHair(h),
      path: `${BASE_DIR}/Hairstyles/Hairstyles_short_${h}.png`,
    });
  for (let t = 1; t <= NUM_TOP; t++)
    specs.push({
      key: texTop(t),
      path: `${BASE_DIR}/Tops/Tops_shirt_${t}.png`,
    });
  for (let b = 1; b <= NUM_BOTTOM; b++)
    specs.push({
      key: texBottom(b),
      path: `${BASE_DIR}/Bottoms/Bottoms_shorts_${b}.png`,
    });
  return specs;
}

export function outfitLayers(o: Outfit): (string | null)[] {
  return [
    texHandBack(o.body),
    texBody(o.body),
    texBottom(o.bottom),
    texTop(o.top),
    o.hair > 0 ? texHair(o.hair) : null,
    texHandFront(o.body),
  ];
}
