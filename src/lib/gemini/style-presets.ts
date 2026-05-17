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
    label: "bold poster illustration",
    promptStyle: "bold poster illustration with simple graphic shapes",
    texture: "clean layered shapes and minimal surface details",
    palette: "bold but controlled color blocking",
  },
  {
    id: "paper-cut-collage",
    label: "paper cut illustration",
    promptStyle: "paper cut illustration with layered handmade shapes",
    texture: "soft paper edges and simple handcrafted texture",
    palette: "playful matte colors with strong shape contrast",
  },
  {
    id: "storybook-gouache",
    label: "soft storybook painting",
    promptStyle: "soft storybook painting with rounded forms",
    texture: "soft brush texture with rounded forms",
    palette: "gentle color harmony with soft contrast",
  },
  {
    id: "risograph-print",
    label: "vintage print poster",
    promptStyle: "vintage print poster illustration with simple shapes",
    texture: "light print grain and simplified ink texture",
    palette: "limited spot-color palette with strong contrast",
  },
  {
    id: "clay-diorama",
    label: "clay model scene",
    promptStyle: "small clay model scene illustration",
    texture: "soft sculpted forms with tactile handmade surfaces",
    palette: "friendly toy-like colors with clear separation",
  },
  {
    id: "ink-line-drawing",
    label: "ink drawing",
    promptStyle: "expressive ink drawing with simple color fills",
    texture: "visible linework and sparse shading",
    palette: "restrained palette with one or two accent colors",
  },
  {
    id: "clean-vector-scene",
    label: "clean vector illustration",
    promptStyle: "clean vector illustration with crisp silhouettes",
    texture: "smooth simple shapes with subtle gradients and neat object edges",
    palette: "bright balanced colors with strong contrast",
  },
  {
    id: "cozy-watercolor",
    label: "cozy watercolor",
    promptStyle: "cozy watercolor illustration with clear subject shapes",
    texture: "soft paper wash with light ink definition and low clutter",
    palette: "warm gentle colors with distinct accents",
  },
  {
    id: "colored-pencil",
    label: "colored pencil",
    promptStyle: "colored pencil illustration with soft hand-drawn lines",
    texture: "visible pencil strokes, gentle shading, and simple surfaces",
    palette: "warm familiar colors with light paper texture",
  },
  {
    id: "soft-3d-toy-scene",
    label: "soft 3D toy scene",
    promptStyle: "soft 3D toy scene illustration with rounded simple forms",
    texture: "matte plastic or rubber-like surfaces with gentle shadows",
    palette: "friendly colors with strong subject-background separation",
  },
  {
    id: "simple-modern-illustration",
    label: "simple modern illustration",
    promptStyle: "simple modern illustration with one focused visual idea",
    texture: "flat shapes, sparse details, and crisp negative space",
    palette: "restrained palette with a bright focal accent",
  },
  {
    id: "anime-background",
    label: "anime background",
    promptStyle: "simple anime background illustration with clear everyday objects",
    texture: "clean painted surfaces, soft shadows, and tidy silhouettes",
    palette: "natural colors with gentle cinematic accents",
  },
  {
    id: "marker-sketch",
    label: "marker sketch",
    promptStyle: "clean marker sketch illustration with confident outlines",
    texture: "visible marker fills, simple hatching, and uncluttered surfaces",
    palette: "lively but controlled colors with clear contrast",
  },
  {
    id: "comic-book-illustration",
    label: "comic book illustration",
    promptStyle: "clean comic book illustration without speech bubbles or text",
    texture: "bold outlines, simple cel shading, and energetic shapes",
    palette: "punchy colors with clear light and shadow",
  },
  {
    id: "pixel-art",
    label: "pixel art",
    promptStyle: "pixel art illustration with large simple shapes",
    texture: "crisp pixel blocks, minimal dithering, and simple object outlines",
    palette: "limited game-like colors with strong contrast",
  },
  {
    id: "soft-pastel-drawing",
    label: "soft pastel drawing",
    promptStyle: "soft pastel drawing with a gentle storybook mood",
    texture: "powdery pastel texture, blended shading, and rounded forms",
    palette: "muted storybook colors with one warm accent",
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
