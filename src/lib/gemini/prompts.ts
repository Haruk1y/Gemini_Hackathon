import type { AspectRatio, RoomSettings } from "@/lib/types/game";

const GM_THEME_POOL = [
  "空想都市の祭り",
  "砂漠の探検",
  "海中のマーケット",
  "雪山の基地",
  "レトロ未来の工房",
  "巨大植物の森",
  "雲上の港",
  "古代遺跡の内部",
  "深夜の遊園地",
  "異世界の温室",
  "浮遊島の村",
  "地下洞窟の湖",
];

const GM_SUBJECT_POOL = [
  "mechanic owl",
  "street chef raccoon",
  "tiny astronaut",
  "glass golem",
  "wind-up robot",
  "desert fox courier",
  "lantern fish merchant",
  "paper knight",
  "clockmaker rabbit",
  "jungle botanist",
  "snowboard penguin",
  "volcanic blacksmith",
];

const GM_COMPOSITION_POOL = [
  "centered close-up",
  "low-angle heroic shot",
  "wide shot with clear depth layers",
  "over-the-shoulder dynamic framing",
  "symmetrical front composition",
  "diagonal action composition",
];

const GM_LIGHT_POOL = [
  "strong rim light",
  "soft morning haze",
  "sunset backlight",
  "hard noon light and sharp shadow",
  "colorful neon bounce light",
  "single spotlight in dark scene",
];

const GM_COLOR_POOL = [
  "teal and orange",
  "magenta and cyan",
  "yellow and cobalt blue",
  "emerald and coral red",
  "indigo and warm amber",
  "lime and cherry red",
];

function pickOne(values: string[]): string {
  const index = Math.floor(Math.random() * values.length);
  return values[index] ?? values[0] ?? "visual theme";
}

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
  const theme = pickOne(GM_THEME_POOL);
  const subject = pickOne(GM_SUBJECT_POOL);
  const composition = pickOne(GM_COMPOSITION_POOL);
  const lighting = pickOne(GM_LIGHT_POOL);
  const palette = pickOne(GM_COLOR_POOL);

  return [
    `アスペクト比 ${aspectRatio} で生成しやすいお題を1つ作成。`,
    `今回のテーマ: ${theme}`,
    `主役候補: ${subject}`,
    `推奨構図: ${composition}`,
    `推奨ライティング: ${lighting}`,
    `推奨カラー: ${palette}`,
    "被写体、背景、構図、光、色、質感を具体化し、前回と重複しにくい内容にする。",
    "テキストは画像内に入れない。",
    "安易な定番(猫+寿司+ネオン等)だけに偏らず、場所・被写体・行動を毎回変える。",
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
