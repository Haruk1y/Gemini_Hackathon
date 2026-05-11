export const STAMPS = [
  { id: "nice", emoji: "👍", label: "ナイス", labelEn: "Nice" },
  { id: "lol", emoji: "😂", label: "草", labelEn: "LOL" },
  { id: "wow", emoji: "😳", label: "えっ", labelEn: "Whoa" },
  { id: "genius", emoji: "🔥", label: "天才", labelEn: "Genius" },
  { id: "close", emoji: "😭", label: "惜しい", labelEn: "So close" },
  { id: "hmm", emoji: "🤔", label: "なるほど", labelEn: "I see" },
] as const;

export type StampId = (typeof STAMPS)[number]["id"];

export function findStamp(stampId: string) {
  return STAMPS.find((stamp) => stamp.id === stampId) ?? null;
}
