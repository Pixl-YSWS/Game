// Shared emote table. Keys must match the server's ALLOWED_EMOTES set; the
// glyph is what pops in the bubble above a player's head.
export const EMOTES: { key: string; glyph: string; label: string }[] = [
  { key: "wave", glyph: "👋", label: "Wave" },
  { key: "laugh", glyph: "😂", label: "Laugh" },
  { key: "heart", glyph: "❤️", label: "Heart" },
  { key: "cry", glyph: "😢", label: "Cry" },
  { key: "angry", glyph: "😠", label: "Angry" },
  { key: "dance", glyph: "🕺", label: "Dance" },
];

export function emoteGlyph(key: string): string {
  return EMOTES.find((e) => e.key === key)?.glyph ?? "❔";
}
