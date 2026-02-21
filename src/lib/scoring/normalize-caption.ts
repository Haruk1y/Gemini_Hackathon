import type { CaptionSchema } from "@/lib/gemini/schemas";

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizeArray(values: string[]): string[] {
  return values.map(normalizeText).filter(Boolean).sort((a, b) => a.localeCompare(b));
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
