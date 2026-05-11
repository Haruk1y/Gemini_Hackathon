import type { CaptionSchema } from "@/lib/gemini/schemas";
import type { GameMode } from "@/lib/types/game";

export const MAX_STANDARD_CPU_PLAYERS = 3;
export const MAX_IMPOSTOR_CPU_PLAYERS = 6;

const CPU_PROMPT_PROFILES = [
  {
    styleFallbacks: [
      "simple stylized illustration",
      "clean cartoon illustration",
      "soft digital illustration",
    ],
    compositions: [
      "off-center medium shot",
      "simple cropped view",
      "slightly low-angle composition",
    ],
    details: [
      "clean generic background",
      "large readable shapes",
      "few accessories",
      "soft simple lighting",
    ],
    maxObjects: 1,
    maxColors: 2,
  },
  {
    styleFallbacks: [
      "flat poster-like illustration",
      "minimal digital artwork",
      "simple mascot-style artwork",
    ],
    compositions: [
      "wide flat composition",
      "centered simple composition",
      "straight-on view",
    ],
    details: [
      "reduced surface texture",
      "sparse background elements",
      "simple color blocks",
      "plain foreground shapes",
    ],
    maxObjects: 1,
    maxColors: 1,
  },
  {
    styleFallbacks: [
      "rough playful illustration",
      "simple storybook illustration",
      "clean sketch-like digital art",
    ],
    compositions: [
      "wider loose composition",
      "slightly messy balanced view",
      "simple side-view composition",
    ],
    details: [
      "generic background shapes",
      "one extra simple prop",
      "minimal decorative detail",
      "clear subject silhouette",
    ],
    maxObjects: 2,
    maxColors: 2,
  },
] as const;

const CPU_GENERIC_PROPS = [
  "small marker",
  "plain crate",
  "simple tool",
  "round object",
  "small lamp",
  "simple stand",
] as const;

const CPU_COLOR_PALETTES = [
  "muted warm",
  "cool pastel",
  "limited green and cream",
  "soft blue and gray",
  "simple red and beige",
  "low-contrast earthy",
] as const;

const CPU_BACKGROUND_QUALITIES = [
  "sparse background",
  "clean open space",
  "minimal scenery",
  "plain distant background",
] as const;

export function getMaxCpuPlayersForMode(gameMode: GameMode): number {
  if (gameMode === "impostor") {
    return MAX_IMPOSTOR_CPU_PLAYERS;
  }

  if (gameMode === "classic" || gameMode === "memory") {
    return MAX_STANDARD_CPU_PLAYERS;
  }

  return 0;
}

export function normalizeCpuCountForMode(params: {
  gameMode: GameMode;
  cpuCount?: number;
  availableSlots?: number;
}): number {
  const requested = Math.max(0, Math.floor(params.cpuCount ?? 0));
  const maxForMode = getMaxCpuPlayersForMode(params.gameMode);
  const availableSlots =
    typeof params.availableSlots === "number"
      ? Math.max(0, Math.floor(params.availableSlots))
      : Number.POSITIVE_INFINITY;

  return Math.min(requested, maxForMode, availableSlots);
}

function pickByCpuIndex<T>(items: readonly T[], cpuIndex: number): T {
  const fallback = items[0];
  if (fallback === undefined) {
    throw new Error("Cannot pick a CPU profile from an empty list.");
  }

  const index = Math.max(0, Math.floor(cpuIndex) - 1);
  return items[index % items.length] ?? fallback;
}

function pickRandom<T>(items: readonly T[], random: () => number): T {
  const fallback = items[0];
  if (fallback === undefined) {
    throw new Error("Cannot pick a CPU mistake from an empty list.");
  }

  const index = Math.min(
    items.length - 1,
    Math.max(0, Math.floor(random() * items.length)),
  );
  return items[index] ?? fallback;
}

function limitWords(value: string, maxWords: number): string {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return words.join(" ");
  }

  return `${words.slice(0, maxWords).join(" ")}...`;
}

function cleanPromptFragment(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/[.。]+$/g, "")
    .trim();
}

function compactList(values: string[], limit: number): string[] {
  return values.map(cleanPromptFragment).filter(Boolean).slice(0, limit);
}

function compactText(value: string, fallback: string, maxWords = 12): string {
  const cleaned = cleanPromptFragment(value);
  return limitWords(cleaned || fallback, maxWords);
}

function joinNaturalList(values: string[]): string {
  if (values.length <= 1) {
    return values[0] ?? "";
  }

  const last = values.at(-1);
  return `${values.slice(0, -1).join(", ")} and ${last}`;
}

function maybeUseCaptionValue(
  random: () => number,
  probability = 0.65,
): boolean {
  return random() < probability;
}

function summarizeCpuMemory(basePrompt: string): string {
  const normalized = basePrompt.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "a vague image prompt";
  }

  const clauses = normalized
    .split(/[.!?;:\n,]+/)
    .map((clause) => clause.trim())
    .filter(Boolean);
  const memory = clauses.slice(0, 2).join(", ") || normalized;

  return limitWords(memory, 24);
}

function sentenceCasePromptSubject(value: string): string {
  return value
    .replace(/^A\s+/, "a ")
    .replace(/^An\s+/, "an ")
    .replace(/^The\s+/, "the ");
}

function buildColorFragment(params: {
  caption: CaptionSchema;
  maxColors: number;
  random: () => number;
}): string {
  const colors = compactList(params.caption.colors, params.maxColors);
  if (colors.length > 0 && maybeUseCaptionValue(params.random, 0.55)) {
    return `${joinNaturalList(colors)} color palette`;
  }

  return `${pickRandom(CPU_COLOR_PALETTES, params.random)} color palette`;
}

function buildObjectFragment(params: {
  caption: CaptionSchema;
  maxObjects: number;
  random: () => number;
}): string {
  const objects = compactList(params.caption.keyObjects, params.maxObjects);
  if (objects.length > 0 && maybeUseCaptionValue(params.random, 0.45)) {
    return `with simplified ${joinNaturalList(objects)}`;
  }

  return `with a ${pickRandom(CPU_GENERIC_PROPS, params.random)}`;
}

function buildStyleFragment(params: {
  caption: CaptionSchema;
  styleFallbacks: readonly string[];
  random: () => number;
}): string {
  const style = compactText(params.caption.style, "", 6);
  if (style && maybeUseCaptionValue(params.random, 0.6)) {
    return style;
  }

  return pickRandom(params.styleFallbacks, params.random);
}

function buildCaptionBackedPrompt(params: {
  caption: CaptionSchema;
  basePrompt: string;
  cpuIndex: number;
  random: () => number;
}): string {
  const profile = pickByCpuIndex(CPU_PROMPT_PROFILES, params.cpuIndex);
  const subjects = compactList(params.caption.mainSubjects, 1);
  const subject = subjects.length
    ? joinNaturalList(subjects)
    : sentenceCasePromptSubject(summarizeCpuMemory(params.basePrompt));
  const scene = compactText(params.caption.scene, "simple scene", 12);
  const style = buildStyleFragment({
    caption: params.caption,
    styleFallbacks: profile.styleFallbacks,
    random: params.random,
  });
  const composition = maybeUseCaptionValue(params.random, 0.35)
    ? compactText(params.caption.composition, "simple composition", 8)
    : pickRandom(profile.compositions, params.random);
  const colorFragment = buildColorFragment({
    caption: params.caption,
    maxColors: profile.maxColors,
    random: params.random,
  });
  const objectFragment = buildObjectFragment({
    caption: params.caption,
    maxObjects: profile.maxObjects,
    random: params.random,
  });
  const detailFragments = [
    pickRandom(profile.details, params.random),
    pickRandom(CPU_BACKGROUND_QUALITIES, params.random),
  ];

  return [
    subject,
    style,
    scene,
    composition,
    colorFragment,
    objectFragment,
    ...detailFragments,
    "clean readable composition",
    "no text",
    "no logos",
    "no trademarks",
    "no watermark",
  ].join(", ");
}

export function buildStandardCpuPrompt(params: {
  basePrompt: string;
  cpuIndex: number;
  caption?: CaptionSchema;
  random?: () => number;
}): string {
  const random = params.random ?? Math.random;

  if (params.caption) {
    return buildCaptionBackedPrompt({
      caption: params.caption,
      basePrompt: params.basePrompt,
      cpuIndex: params.cpuIndex,
      random,
    });
  }

  const profile = pickByCpuIndex(CPU_PROMPT_PROFILES, params.cpuIndex);
  const fuzzyMemory = sentenceCasePromptSubject(
    summarizeCpuMemory(params.basePrompt),
  );

  return [
    fuzzyMemory,
    pickRandom(profile.styleFallbacks, random),
    pickRandom(profile.compositions, random),
    pickRandom(CPU_COLOR_PALETTES, random),
    pickRandom(profile.details, random),
    "clean readable composition",
    "no text",
    "no logos",
    "no trademarks",
    "no watermark",
  ].join(", ");
}
