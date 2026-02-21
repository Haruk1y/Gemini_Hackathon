import type { AspectRatio, RoomSettings } from "@/lib/types/game";

export function gmSystemPrompt(settings: RoomSettings): string {
  return [
    "あなたは画像生成ゲームのゲームマスターです。",
    "必ずJSONのみを返してください。",
    "ネオブルータリズムのポップな世界観（太線・ステッカー感・高彩度）に合うお題を作成してください。",
    "著作権リスクを避けるため、有名キャラクター、ロゴ、実在ブランド文字列は避けてください。",
    `出力は難易度1-5、アスペクト比 ${settings.aspectRatio} を想定した内容にしてください。`,
  ].join("\n");
}

export function gmUserPrompt(aspectRatio: AspectRatio): string {
  return [
    `アスペクト比 ${aspectRatio} で生成しやすいお題を1つ作成。`,
    "被写体、背景、構図、光、色、質感を具体化。",
    "テキストは画像内に入れない。",
  ].join("\n");
}

export const captionPrompt = [
  "この画像をゲーム採点用に説明してください。",
  "主役・小物・配色・構図・スタイルを具体的に分解。",
  "推測ではなく見えている内容を優先。",
].join("\n");

export function hintPrompt(params: {
  targetCaption: string;
  latestCaption: string;
  latestPrompt: string;
}): string {
  return [
    "あなたは画像生成ゲームのコーチです。",
    "ターゲット画像に近づくための差分指示を作ってください。",
    "JSONのみを返してください。",
    `ターゲット要約: ${params.targetCaption}`,
    `現在画像要約: ${params.latestCaption}`,
    `現在のプロンプト: ${params.latestPrompt}`,
  ].join("\n");
}
