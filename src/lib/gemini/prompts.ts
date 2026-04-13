import type { CaptionSchema } from "@/lib/gemini/schemas";
import type { AspectRatio, ImpostorRole, RoomSettings } from "@/lib/types/game";

export function gmSystemPrompt(settings: RoomSettings): string {
  return [
    "あなたは画像生成ゲームのゲームマスターです。",
    "ネオブルータリズムのポップな世界観（太線・ステッカー感・高彩度）に合うお題を作成してください。",
    "著作権リスクを避けるため、有名キャラクター、ロゴ、実在ブランド文字列は避けてください。",
    "出力は、画像生成にそのまま使える完成済みの英語プロンプト1本だけにしてください。",
    "JSON、Markdown、説明文、前置き、箇条書きは不要です。",
    `出力はアスペクト比 ${settings.aspectRatio} を想定した内容にしてください。`,
  ].join("\n");
}

export function gmUserPrompt(params: { aspectRatio: AspectRatio }): string {
  return [
    `アスペクト比 ${params.aspectRatio} で生成しやすいお題を1つ作成。`,
    "被写体、背景、行動、構図、光、色、質感を具体化する。",
    "テキストは画像内に入れない。",
    "ネオブルータルなポップ調、太線、高彩度、ステッカー感のあるビジュアルにする。",
    "ひと目でテーマが伝わる具体的な1シーンにする。",
    "返答は英語プロンプト1本のみ。",
  ].join("\n");
}

export const captionPrompt = [
  "この画像をゲーム採点用に説明してください。",
  "主役・小物・配色・構図・スタイルを具体的に分解。",
  "推測ではなく見えている内容を優先。",
].join("\n");

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
