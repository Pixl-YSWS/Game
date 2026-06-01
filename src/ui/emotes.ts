import { EMOTE_ATLAS } from "./theme";

export interface Emote {
  key: string;
  frame: string;
  label: string;
}

export const EMOTES: Emote[] = [
  { key: "happy", frame: "emote_faceHappy.png", label: "Happy" },
  { key: "laugh", frame: "emote_laugh.png", label: "Laugh" },
  { key: "heart", frame: "emote_heart.png", label: "Heart" },
  { key: "sad", frame: "emote_faceSad.png", label: "Sad" },
  { key: "angry", frame: "emote_faceAngry.png", label: "Angry" },
  { key: "love", frame: "emote_hearts.png", label: "Love" },
  { key: "cry", frame: "emote_drop.png", label: "Cry" },
  { key: "idea", frame: "emote_idea.png", label: "Idea" },
  { key: "music", frame: "emote_music.png", label: "Music" },
  { key: "sleep", frame: "emote_sleep.png", label: "Sleep" },
  { key: "star", frame: "emote_star.png", label: "Star" },
  { key: "question", frame: "emote_question.png", label: "Question" },
  { key: "alert", frame: "emote_alert.png", label: "Alert" },
  { key: "exclaim", frame: "emote_exclamation.png", label: "Wow" },
  { key: "dizzy", frame: "emote_swirl.png", label: "Dizzy" },
];

export const QUICK_EMOTES = EMOTES.slice(0, 5);

/** All emote keys — the client/server allow-list is derived from this. */
export const EMOTE_KEYS = EMOTES.map((e) => e.key);

export { EMOTE_ATLAS };

/** Resolve an emote key to its atlas frame (falls back to a "?" emote). */
export function emoteFrame(key: string): string {
  return EMOTES.find((e) => e.key === key)?.frame ?? "emote_question.png";
}
