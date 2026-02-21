import type { CaptionSchema } from "@/lib/gemini/schemas";

const STOPWORDS = new Set(["a", "an", "the"]);

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizePhrase(text: string): string {
  const lowered = normalizeText(text);
  const withoutArticle = lowered.replace(/^(a|an|the)\s+/i, "").trim();
  if (!withoutArticle) return "";
  if (STOPWORDS.has(withoutArticle)) return "";
  if (withoutArticle.length <= 1) return "";
  return withoutArticle;
}

function normalizeArray(values: string[]): string[] {
  const normalized = values.map(normalizePhrase).filter(Boolean).sort((a, b) => a.localeCompare(b));
  return [...new Set(normalized)];
}

export function normalizeCaption(caption: CaptionSchema): string {
  const chunks = [
    `scene:${normalizeText(caption.scene)}`,
    `subjects:${normalizeArray(caption.mainSubjects).join("|")}`,
    `objects:${normalizeArray(caption.keyObjects).join("|")}`,
    `colors:${normalizeArray(caption.colors).join("|")}`,
    `style:${normalizeText(caption.style)}`,
    `composition:${normalizeText(caption.composition)}`,
    `text:${normalizeText(caption.textInImage ?? "none")}`,
  ];

  return chunks.join("; ");
}
