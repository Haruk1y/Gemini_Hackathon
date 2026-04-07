import type { AspectRatio, RoomSettings } from "@/lib/types/game";

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
