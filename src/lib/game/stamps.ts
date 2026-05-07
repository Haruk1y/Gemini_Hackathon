export const STAMPS = [
  { id: "nice", emoji: "👍", label: "ナイス" },
  { id: "lol", emoji: "😂", label: "草" },
  { id: "wow", emoji: "😳", label: "えっ" },
  { id: "genius", emoji: "🔥", label: "天才" },
  { id: "close", emoji: "😭", label: "惜しい" },
  { id: "hmm", emoji: "🤔", label: "なるほど" },
] as const;

export type StampId = (typeof STAMPS)[number]["id"];

export function findStamp(stampId: string) {
  return STAMPS.find((stamp) => stamp.id === stampId) ?? null;
}
