import type { ChallengeSeed } from "@/lib/gemini/challenge-seed";
import type { AspectRatio, RoomSettings } from "@/lib/types/game";

export function gmSystemPrompt(settings: RoomSettings): string {
  return [
    "あなたは画像生成ゲームのゲームマスターです。",
    "毎ラウンド、題材・舞台・ひねり・構図がしっかり変わる、意外性のあるお題を作成してください。",
    "ただし画風は毎回、ベクターイラスト感のあるポップで見やすい方向に統一してください。",
    "画風は、クリーンなベクターイラスト、太めの輪郭線、フラットな塗り、最小限の質感で統一してください。",
    "抽象的すぎず、ひと目で伝わる具体的な1シーンにしてください。",
    "著作権リスクを避けるため、有名キャラクター、ロゴ、実在ブランド文字列は避けてください。",
    "画像の中に文字・数字・記号・看板・ラベル・吹き出しを絶対に入れないでください。",
    "出力は短く具体的にしてください。冗長な修飾や言い換えは不要です。",
    "長さは最大220文字程度、短い1文または短いカンマ列にしてください。",
    "出力は、画像生成にそのまま使える完成済みの英語プロンプト1本だけにしてください。",
    "JSON、Markdown、説明文、前置き、箇条書きは不要です。",
    `出力はアスペクト比 ${settings.aspectRatio} を想定した内容にしてください。`,
  ].join("\n");
}

export function gmUserPrompt(params: {
  aspectRatio: AspectRatio;
  seed: ChallengeSeed;
  seedPrompt: string;
}): string {
  return [
    `アスペクト比 ${params.aspectRatio} で生成しやすいお題を1つ作成。以下の seed を必ずすべて反映する。`,
    `Main subject: ${params.seed.subject} (${params.seed.subjectCategory})`,
    `Action: ${params.seed.action}`,
    `Setting: ${params.seed.setting}`,
    `Twist: ${params.seed.twist}`,
    `Style family: ${params.seed.styleFamily}`,
    `Composition: ${params.seed.composition}`,
    `Lighting and color: ${params.seed.lightingColor}`,
    `Supporting detail: ${params.seed.supportingDetail}`,
    "被写体、背景、行動、構図、光、色、質感を具体化する。",
    "画像内にテキストは絶対に入れない。文字、数字、記号、看板、ラベル、UI、吹き出しも禁止。",
    "面白さと視覚的フックを強めつつ、1枚の画像として自然に成立させる。",
    "画風はクリーンなベクターイラスト寄りで統一し、写実写真、油彩、粘土、コラージュのようにはしない。",
    "面はフラットに、輪郭線は太めに、質感や筆致はできるだけ抑える。",
    "返答は短く、最大220文字程度に収める。長い説明文にしない。",
    "seed の要素は消さずに、自然な英語の画像生成プロンプトとして仕上げる。",
    `Draft prompt: ${params.seedPrompt}`,
    "返答は英語プロンプト1本のみ。",
  ].join("\n");
}

export const captionPrompt = [
  "この画像をゲーム採点用に説明してください。",
  "主役・小物・配色・構図・スタイルを具体的に分解。",
  "推測ではなく見えている内容を優先。",
].join("\n");
