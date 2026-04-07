export interface ChallengeSeed {
  subjectCategory: string;
  subject: string;
  action: string;
  setting: string;
  twist: string;
  styleFamily: string;
  composition: string;
  lightingColor: string;
  supportingDetail: string;
}

const SUBJECTS = {
  animal: [
    "capybara",
    "raccoon",
    "axolotl",
    "alpaca",
    "pigeon",
    "orca",
    "chameleon",
    "mole",
  ],
  food: [
    "towering ramen bowl",
    "croissant dragon",
    "dumpling hero",
    "giant strawberry",
    "sushi train mascot",
    "melting ice cream wizard",
    "cheese moon rover",
    "pancake drummer",
  ],
  everydayObject: [
    "umbrella knight",
    "toaster athlete",
    "rubber duck captain",
    "traffic cone wizard",
    "vacuum cleaner racer",
    "desk lamp detective",
    "paper fan acrobat",
    "shopping basket robot",
  ],
  machine: [
    "retro robot",
    "mini excavator",
    "tiny submarine scooter",
    "clockwork parade machine",
    "rocket-powered espresso machine",
    "drone orchestra leader",
    "antenna-covered moon buggy",
  ],
  fantasyBeing: [
    "moss golem",
    "cloud dragon",
    "neon phoenix",
    "jelly wizard",
    "lantern spirit",
    "star sheep",
    "crystal goblin",
    "moon rabbit alchemist",
  ],
  bizarreObject: [
    "singing stone head",
    "walking mailbox planet",
    "floating bathtub throne",
    "cube-shaped storm cloud",
    "handheld volcano pet",
    "giant key made of noodles",
    "accordion moon",
    "museum statue on roller skates",
  ],
} as const;

const ACTIONS = [
  "performing a dramatic rescue",
  "winning a chaotic street race",
  "trying to keep balance on a slippery stage",
  "celebrating an absurd championship",
  "escaping with ridiculous confidence",
  "working the busiest shift of its life",
  "transforming mid-motion",
  "causing accidental mayhem",
  "showing off an absurd skill with total seriousness",
  "posing like a legendary hero after a tiny victory",
] as const;

const SETTINGS = [
  "inside an underwater bathhouse",
  "inside a lantern-filled festival alley",
  "in a retro-futuristic hot spring town",
  "at a miniature construction site",
  "inside a cloud-top arrival hall",
  "through a glowing rainy alley",
  "in a haunted amusement park at dawn",
  "inside a mossy abandoned factory",
  "on a floating island above the ocean",
  "in a tiny apartment built inside a giant toy machine",
] as const;

const TWISTS = [
  "everything around it is either way too tiny or way too huge",
  "gravity is tilted sideways",
  "the usual roles are completely reversed",
  "every face in the scene is comically overdramatic",
  "one bizarre tool is clearly solving everything",
  "the season feels hilariously wrong for the setting",
  "the entire scene looks one second away from a glorious disaster",
  "it is treated with epic seriousness despite being obviously silly",
] as const;

const VECTOR_STYLE_FAMILY =
  "clean playful vector illustration, crisp bold outlines, flat cel-shaded colors, geometric shapes, sticker-like silhouette, minimal texture";

const COMPOSITIONS = [
  "front-facing centered",
  "dramatic low-angle",
  "bird's-eye view",
  "extreme close-up with layered foreground details",
  "wide ensemble shot with one obvious focal subject",
  "off-center dynamic action framing",
] as const;

const LIGHTING_AND_COLOR = [
  "neon magenta and cyan glow",
  "warm sunrise haze with long shadows",
  "golden spotlight and deep black contrast",
  "foggy pastel light with soft reflections",
  "electric primary-color burst",
  "moonlit blue atmosphere with sharp highlights",
  "sunset orange against cool teal accents",
  "festival lantern light with saturated reds and yellows",
] as const;

const SUPPORTING_DETAILS = [
  "scattered props that tell a tiny side story",
  "a crowd of onlookers reacting way too intensely",
  "one unmistakable prop that explains the joke instantly",
  "small environmental details that reward a second look",
  "texture-rich surfaces and tactile materials everywhere",
  "motion trails and debris emphasizing the chaos",
  "a dramatic background element that feels almost theatrical",
  "layered foreground objects adding depth and mischief",
] as const;

function pickOne<T>(values: readonly T[], rng: () => number): T {
  return values[Math.floor(rng() * values.length)] ?? values[0];
}

export function createChallengeSeed(rng: () => number = Math.random): ChallengeSeed {
  const category = pickOne(Object.keys(SUBJECTS) as Array<keyof typeof SUBJECTS>, rng);

  return {
    subjectCategory: category,
    subject: pickOne(SUBJECTS[category], rng),
    action: pickOne(ACTIONS, rng),
    setting: pickOne(SETTINGS, rng),
    twist: pickOne(TWISTS, rng),
    styleFamily: VECTOR_STYLE_FAMILY,
    composition: pickOne(COMPOSITIONS, rng),
    lightingColor: pickOne(LIGHTING_AND_COLOR, rng),
    supportingDetail: pickOne(SUPPORTING_DETAILS, rng),
  };
}

export function buildPromptFromChallengeSeed(
  seed: ChallengeSeed,
): string {
  return [
    `Flat-color vector illustration of ${seed.subject} ${seed.action}`,
    seed.setting,
    "no text, no letters, no numbers, no logos",
    seed.twist,
    `${seed.composition}, ${seed.lightingColor}`,
  ].join(", ");
}
