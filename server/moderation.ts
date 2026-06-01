// HEHEHE... OFC THEY R BANNED

const BAD_WORDS = [
  "fuck",
  "fucker",
  "fucking",
  "motherfucker",
  "shit",
  "bullshit",
  "shitty",
  "bitch",
  "bitches",
  "bastard",
  "asshole",
  "ass",
  "jackass",
  "dickhead",
  "dick",
  "piss",
  "pissed",
  "cunt",
  "slut",
  "whore",
  "douche",
  "douchebag",

  "nigger",
  "nigga",
  "ngga",
  "nga",
  "faggot",
  "fag",
  "retard",
  "retarded",

  "fck",
  "fk",
  "fucc",
  "fuk",
  "fukc",
  "sh1t",
  "shyt",
  "b1tch",
  "a55hole",
  "dik",
  "wtf",
  "stfu",
  "gtfo",
  "tf",
];

const PATTERN = new RegExp(
  `\\b(${BAD_WORDS.sort((a, b) => b.length - a.length)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")})\\b`,
  "gi",
);

export function censorChat(text: string): string {
  return text.replace(PATTERN, (m) => "*".repeat(m.length));
}
