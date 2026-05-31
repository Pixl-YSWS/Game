// Server-side chat profanity filter. Runs on every chat line before it's
// broadcast, so a censored word can never reach another client. The match is
// case-insensitive and replaces each offending run with asterisks (Minecraft
// style), preserving length so the sentence still reads naturally.

// Curated block list. Kept deliberately short and obvious; extend as needed.
const BAD_WORDS = [
  "fuck", "fucker", "fucking", "motherfucker",
  "shit", "bullshit", "bitch", "bastard",
  "asshole", "dickhead", "dick", "piss",
  "cunt", "slut", "whore", "douche",
  "nigger", "nigga", "faggot", "fag", "retard",
];

// One big alternation, longest-first so "motherfucker" wins over "fuck".
const PATTERN = new RegExp(
  `(${[...BAD_WORDS].sort((a, b) => b.length - a.length).join("|")})`,
  "gi",
);

/** Replace any blocked word with asterisks of the same length. */
export function censorChat(text: string): string {
  return text.replace(PATTERN, (m) => "*".repeat(m.length));
}
