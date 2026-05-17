import type { CaptionSchema } from "@/lib/gemini/schemas";
import type { GmStylePreset } from "@/lib/gemini/style-presets";
import type {
  AspectRatio,
  ImpostorRole,
  NormalizedBox,
  RoomSettings,
} from "@/lib/types/game";

export function gmSystemPrompt(
  settings: RoomSettings,
  stylePreset: GmStylePreset,
): string {
  return [
    "# Task",
    "- Write one playful, readable, production-ready English prompt for generating a target image in an image-generation guessing game.",
    "",
    "# Style",
    `- Visual style: ${stylePreset.label}.`,
    `- Style details: ${stylePreset.promptStyle}; ${stylePreset.texture}; ${stylePreset.palette}.`,
    "",
    "# Content Requirements",
    "- Follow the selected style precisely.",
    "- Specify a concrete subject, setting, action, composition, lighting, colors, and material qualities.",
    "- Keep the composition simple: one main subject, two or three important props, and one readable background scene.",
    `- Make the prompt suitable for aspect ratio ${settings.aspectRatio}.`,
    "",
    "# Constraints",
    "- Avoid copyright risk: no famous characters, logos, real brand names, trademarks, or readable text.",
    "- Avoid photorealism, crowds, excessive detail, tiny unreadable elements, and text elements.",
    "",
    "# Output Format",
    "- Return exactly one finished English image-generation prompt as plain text that can be sent directly to an image model.",
    "- Do not return JSON, Markdown, explanation, preface, labels, or bullet points.",
  ].join("\n");
}

export function changeSceneSystemPrompt(settings: RoomSettings): string {
  return [
    "You create one polished English image-generation prompt for a spot-the-difference party game.",
    "The image must be photorealistic and grounded in the real world.",
    "Prefer prop-rich indoor or street scenes with many small objects to scan.",
    "Keep the camera stable, the composition readable, and the scene free of text, logos, brands, or signage.",
    "Avoid close-up human faces, crowds, screens, books, labels, and posters.",
    "Avoid illustration, collage, clay, gouache, risograph, or stylized art directions.",
    `The prompt should fit aspect ratio ${settings.aspectRatio}.`,
    "Return exactly one English prompt and nothing else.",
  ].join("\n");
}

export function changeSceneUserPrompt(params: {
  aspectRatio: AspectRatio;
}): string {
  return [
    `Create one realistic scene for aspect ratio ${params.aspectRatio}.`,
    "Use a single coherent location with one stable camera angle.",
    "Include one main area plus many supporting props and household or street objects.",
    "Make the image rich enough for a hidden one-object change, but not chaotic.",
    "Return only the final English prompt.",
  ].join("\n");
}

export const captionPrompt = [
  "Describe this image for game scoring.",
  "Break down the visible scene, main subjects, key objects, colors, composition, and visual style.",
  "Prioritize what is actually visible over guesses or inferred context.",
].join("\n");

export function changeEditPlanPrompt(caption: CaptionSchema): string {
  return [
    "You are preparing a source-image edit for a spot-the-difference game.",
    "Design exactly one small, localized object-level change.",
    "Keep the camera, framing, lighting, scene layout, and almost all objects unchanged.",
    "The changed object should stay under roughly 10% of the frame and should not trigger a scene-wide redraw.",
    "Preserve all non-target objects, colors, shadows, textures, and background details as closely as possible.",
    "Do not move the camera, crop, relight, recolor the whole scene, or restyle the image.",
    "Do not add or change text, logos, signage, or large background regions.",
    "Prefer changing one portable object, table item, shelf item, bag, lamp, cup, bottle, fruit, toy, or similar prop.",
    "Return JSON only with:",
    '- summary: short English description of the change, e.g. "red mug becomes blue bottle".',
    "- editPrompt: one English source-image editing instruction that strongly preserves everything except the single object change.",
    "",
    `scene: ${caption.scene}`,
    `main subjects: ${joinCaptionList(caption.mainSubjects)}`,
    `key objects: ${joinCaptionList(caption.keyObjects)}`,
    `colors: ${joinCaptionList(caption.colors)}`,
    `style: ${caption.style}`,
    `composition: ${caption.composition}`,
    `text in image: ${caption.textInImage ?? "none"}`,
  ].join("\n");
}

function joinCaptionList(values: string[]) {
  return values.filter(Boolean).join(", ") || "none";
}

export function cpuRewriteSystemPrompt(params: { role: ImpostorRole }): string {
  const roleInstruction =
    params.role === "impostor"
      ? "Keep the image believable, but introduce subtle drift that feels like a human misunderstanding."
      : "Keep the main scene recognizable, but allow moderate human-like variation instead of perfect copying.";

  return [
    "You rewrite a visual description into one English image-generation prompt.",
    "Return exactly one English prompt.",
    "Do not return JSON, markdown, bullets, labels, or explanation.",
    "Preserve the main scene and main subject.",
    "Allow moderate variation in secondary props, color emphasis, framing, lighting, and texture wording.",
    roleInstruction,
    "Do not mention the game, sabotage, hidden roles, or AI.",
    "Do not add text, logos, trademarks, or watermarks.",
  ].join("\n");
}

export function cpuRewriteUserPrompt(params: {
  role: ImpostorRole;
  caption: CaptionSchema;
  reconstructedPrompt: string;
}): string {
  const roleInstruction =
    params.role === "impostor"
      ? "Quietly alter a few plausible details so the drift is noticeable over time, but not obvious in one step."
      : "Make it feel like a different human described and redrew the same image from memory.";

  return [
    "Visible image breakdown:",
    `scene: ${params.caption.scene}`,
    `main subjects: ${joinCaptionList(params.caption.mainSubjects)}`,
    `key objects: ${joinCaptionList(params.caption.keyObjects)}`,
    `colors: ${joinCaptionList(params.caption.colors)}`,
    `style: ${params.caption.style}`,
    `composition: ${params.caption.composition}`,
    `text in image: ${params.caption.textInImage ?? "none"}`,
    "",
    "Current reconstructed base prompt:",
    params.reconstructedPrompt,
    "",
    roleInstruction,
    "Write a polished English prompt for a single generated image only.",
  ].join("\n");
}

export function validateSingleChangePrompt(params: {
  answerBox: NormalizedBox;
}): string {
  const { answerBox } = params;
  return [
    "Compare the two images.",
    "Decide whether exactly one localized object changed while the rest of the scene stayed substantially the same.",
    "Reject if multiple objects changed, if framing or layout changed, or if a large background region changed.",
    `A pixel-diff bounding box candidate is x=${answerBox.x.toFixed(3)}, y=${answerBox.y.toFixed(3)}, width=${answerBox.width.toFixed(3)}, height=${answerBox.height.toFixed(3)} in normalized coordinates.`,
    "Return JSON only with:",
    "- valid: boolean",
    '- changedObject: short English noun phrase',
    "- note: short English explanation",
  ].join("\n");
}
