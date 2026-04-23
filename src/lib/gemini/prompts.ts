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
    "あなたは画像生成ゲームのゲームマスターです。",
    `今回の画風テーマは "${stylePreset.label}" です。`,
    "毎回同じビビッドなステッカー調に寄らず、指定された画風で遊び心のあるお題を作成してください。",
    "著作権リスクを避けるため、有名キャラクター、ロゴ、実在ブランド文字列は避けてください。",
    "出力は、画像生成にそのまま使える完成済みの英語プロンプト1本だけにしてください。",
    "JSON、Markdown、説明文、前置き、箇条書きは不要です。",
    "構図は複雑にしすぎず、主役は1つ、重要小物は2〜3個、背景は1シーンまでに抑えてください。",
    "photoreal すぎる描写、群衆、細かすぎる情報量、文字要素は避けてください。",
    `出力はアスペクト比 ${settings.aspectRatio} を想定した内容にしてください。`,
  ].join("\n");
}

export function gmUserPrompt(params: {
  aspectRatio: AspectRatio;
  stylePreset: GmStylePreset;
}): string {
  return [
    `アスペクト比 ${params.aspectRatio} で生成しやすいお題を1つ作成。`,
    "被写体、背景、行動、構図、光、色、質感を具体化する。",
    "テキストは画像内に入れない。",
    `画風は ${params.stylePreset.label} に固定する。`,
    `スタイル表現には "${params.stylePreset.promptStyle}", "${params.stylePreset.texture}", "${params.stylePreset.palette}" を反映する。`,
    "ひと目でテーマが伝わる具体的な1シーンにする。",
    "主役は1つ、重要小物は2〜3個まで、背景はシンプルに保つ。",
    "返答は英語プロンプト1本のみ。",
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
  "この画像をゲーム採点用に説明してください。",
  "主役・小物・配色・構図・スタイルを具体的に分解。",
  "推測ではなく見えている内容を優先。",
].join("\n");

export function changeEditPlanPrompt(caption: CaptionSchema): string {
  return [
    "You are preparing a source-image edit for a spot-the-difference game.",
    "Design exactly one small, localized object-level change.",
    "Keep the camera, framing, lighting, scene layout, and almost all objects unchanged.",
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
