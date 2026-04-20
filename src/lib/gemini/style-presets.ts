export interface GmStylePreset {
  id: string;
  label: string;
  promptStyle: string;
  texture: string;
  palette: string;
}

export const GM_STYLE_PRESETS: readonly GmStylePreset[] = [
  {
    id: "flat-poster",
    label: "flat poster",
    promptStyle: "flat poster illustration with clear silhouettes",
    texture: "clean layered shapes and minimal surface detail",
    palette: "bold but controlled color blocking",
  },
  {
    id: "paper-cut-collage",
    label: "paper cut collage",
    promptStyle: "paper cut collage illustration",
    texture: "layered cut-paper edges and simple handcrafted texture",
    palette: "playful matte colors with strong shape contrast",
  },
  {
    id: "storybook-gouache",
    label: "soft gouache storybook",
    promptStyle: "storybook gouache illustration",
    texture: "soft brush texture with rounded forms",
    palette: "gentle but readable color harmony",
  },
  {
    id: "risograph-print",
    label: "risograph print",
    promptStyle: "risograph print poster illustration",
    texture: "light print grain and simplified ink overlap",
    palette: "limited spot-color palette with strong contrast",
  },
  {
    id: "clay-diorama",
    label: "clay diorama",
    promptStyle: "small clay diorama illustration",
    texture: "soft sculpted forms with tactile handmade surfaces",
    palette: "friendly toy-like colors with clear separation",
  },
  {
    id: "ink-line-drawing",
    label: "ink line drawing",
    promptStyle: "expressive ink line drawing with flat fills",
    texture: "visible linework and sparse shading",
    palette: "restrained palette with one or two accent colors",
  },
] as const;

export function pickGmStylePreset(params?: {
  excludeIds?: string[];
  random?: () => number;
}): GmStylePreset {
  const excluded = new Set(params?.excludeIds ?? []);
  const available = GM_STYLE_PRESETS.filter((preset) => !excluded.has(preset.id));
  const candidates = available.length > 0 ? available : [...GM_STYLE_PRESETS];
  const random = params?.random ?? Math.random;
  const index = Math.min(
    candidates.length - 1,
    Math.max(0, Math.floor(random() * candidates.length)),
  );

  return candidates[index]!;
}
