const ADJECTIVES = [
  "brass",
  "downbeat",
  "encore",
  "groove",
  "harmony",
  "indigo",
  "jazzy",
  "loud",
  "midnight",
  "offbeat",
  "reverb",
  "sunset",
  "tempo",
  "velvet",
  "wildcard",
];

const NOUNS = [
  "band",
  "crew",
  "combo",
  "ensemble",
  "outfit",
  "quartet",
  "session",
  "setlist",
  "squad",
  "trio",
];

function randomFrom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomSuffix(length = 4): string {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

/** A short, memorable, URL-safe slug for a band's shareable link. */
export function generateSlug(): string {
  return `${randomFrom(ADJECTIVES)}-${randomFrom(NOUNS)}-${randomSuffix()}`;
}
