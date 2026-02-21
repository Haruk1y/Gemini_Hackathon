import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

import { AppError } from "@/lib/utils/errors";
import { captionPrompt, gmSystemPrompt, gmUserPrompt, hintPrompt } from "@/lib/gemini/prompts";
import {
  captionSchema,
  gmPromptSchema,
  hintSchema,
  visualScoreSchema,
  type CaptionSchema,
  type GmPromptSchema,
  type HintSchema,
  type VisualScoreSchema,
} from "@/lib/gemini/schemas";
import type { AspectRatio, RoomSettings } from "@/lib/types/game";

const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL ?? "gemini-2.5-flash";
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image";
const EMBEDDING_MODEL = "gemini-embedding-001";

const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

const mockMode = process.env.MOCK_GEMINI === "true" || !process.env.GEMINI_API_KEY;
const STRUCTURED_PARSE_ATTEMPTS = 1;

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withRetries<T>(fn: () => Promise<T>): Promise<T> {
  const delays = [250, 750, 1500];
  let lastError: unknown = null;

  for (const delay of delays) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const asString = String(error);
      const retryable = /429|RESOURCE_EXHAUSTED|503|500|timeout/i.test(asString);
      if (!retryable) {
        throw error;
      }
      await sleep(delay + Math.floor(Math.random() * 120));
    }
  }

  throw lastError;
}

function buildStructuredCandidates(parsed: unknown): unknown[] {
  const candidates: unknown[] = [];
  const queue: unknown[] = [parsed];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    candidates.push(current);

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    if (typeof current !== "object") {
      continue;
    }

    const objectValue = current as Record<string, unknown>;
    const wrappedKeys = ["data", "result", "output", "response", "value", "candidate", "content"];
    for (const key of wrappedKeys) {
      const nested = objectValue[key];
      if (nested) {
        queue.push(nested);
      }
    }
  }

  return candidates;
}

function parseStructuredText<T>(schema: z.ZodType<T>, text: string): T | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  for (const candidate of buildStructuredCandidates(parsed)) {
    const result = schema.safeParse(candidate);
    if (result.success) {
      return result.data;
    }
  }

  return null;
}

function responseText(response: { text?: string; candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }): string | null {
  const direct = response.text?.trim();
  if (direct) return direct;

  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const combined = parts
    .map((part) => part.text ?? "")
    .join("")
    .trim();

  return combined || null;
}

function fallbackGmPrompt(): GmPromptSchema {
  const subjects = [
    "clockwork owl pilot",
    "street-food robot chef",
    "glass-armored knight",
    "desert fox messenger",
    "jungle biologist",
    "floating whale mechanic",
    "paper samurai",
    "snowboard penguin racer",
    "volcanic blacksmith",
    "tiny astronaut gardener",
    "festival drummer raccoon",
    "lantern fish merchant",
  ];
  const locations = [
    "inside an ancient observatory",
    "at a floating island marketplace",
    "in a misty bamboo canyon",
    "on a sunset harbor bridge",
    "inside a retro train station",
    "at a crystal cave lake",
    "in a stormy sky dock",
    "inside a giant greenhouse",
    "on a rooftop carnival",
    "at a snowy mountain outpost",
  ];
  const actions = [
    "repairing a glowing machine",
    "serving food to travelers",
    "guiding a small parade",
    "preparing for a race",
    "building a wind-powered device",
    "trading luminous plants",
    "reading a holographic map",
    "forging tools with sparks",
    "conducting a tiny orchestra",
    "painting a large mural",
  ];
  const palettes = [
    "teal and orange",
    "magenta and cyan",
    "lime and red",
    "cobalt and yellow",
    "emerald and coral",
    "indigo and amber",
  ];
  const compositions = [
    "centered medium shot",
    "wide shot with layered depth",
    "low-angle heroic framing",
    "diagonal action composition",
    "symmetrical front view",
  ];

  const pick = (values: string[]) => values[Math.floor(Math.random() * values.length)] ?? values[0];
  const subject = pick(subjects);
  const location = pick(locations);
  const action = pick(actions);
  const palette = pick(palettes);
  const composition = pick(compositions);
  const difficulty = 2 + Math.floor(Math.random() * 3);

  const title = `${subject.split(" ")[0]} ${location.replace(/^in |^at /, "").split(" ")[0]}`.slice(0, 80);
  const prompt = [
    `A ${subject} ${action} ${location}`,
    "neo-brutal pop sticker illustration",
    "thick black outlines",
    `high-saturation ${palette} color palette`,
    composition,
    "crisp texture details",
    "no text",
  ].join(", ");

  return {
    title,
    difficulty,
    tags: [subject.split(" ")[0], location.split(" ").slice(-1)[0], palette.split(" and ")[0]]
      .map((tag) => tag.replace(/[^a-zA-Z0-9_-]/g, ""))
      .filter(Boolean)
      .slice(0, 6),
    prompt,
    negativePrompt: "text, logo, watermark, famous characters",
    mustInclude: ["thick black outlines", "high saturation", "clear main subject"],
    mustAvoid: ["brand logo", "copyrighted character"],
  };
}

function fallbackCaption(fallbackPrompt: string): CaptionSchema {
  const tokens = fallbackPrompt
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 4);

  const primary = tokens[0] ?? "subject";
  const scene = `Prompt-guided scene featuring ${primary}`.slice(0, 240);

  return {
    scene,
    mainSubjects: [primary],
    keyObjects: tokens.slice(1, 4),
    colors: ["vivid", "high-contrast"],
    style: "neo-brutal sticker illustration",
    composition: "centered composition",
    textInImage: null,
  };
}

function fallbackHint(latestPrompt: string): HintSchema {
  const improvedPrompt = `${latestPrompt}, add clearer main subject, stronger lighting contrast, and more specific background details`.slice(
    0,
    500,
  );

  return {
    deltaChecklist: [
      "主役を1つに絞って強調する",
      "背景の要素を2-3個に具体化する",
      "光源とコントラストを明示する",
    ],
    improvedPrompt:
      improvedPrompt.length >= 20
        ? improvedPrompt
        : "A vivid neo-brutal sticker illustration with clear subject, concrete background details, and strong contrast lighting",
  };
}

function fallbackVisualScore(): VisualScoreSchema {
  return {
    score: 50,
    matchedElements: [],
    missingElements: [],
    note: "visual scoring fallback",
  };
}

function hashText(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function mockEmbedding(text: string, dimensions = 256): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const tokens = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

  for (const token of tokens) {
    const idx = hashText(token) % dimensions;
    vector[idx] += 1;
  }

  return vector;
}

function placeholderUrl(prompt: string): string {
  const text = encodeURIComponent(prompt.slice(0, 60));
  return `https://placehold.co/1024x1024/FFF7E6/101010/png?text=${text}`;
}

export interface GeneratedImage {
  mimeType: string;
  base64Data?: string;
  directUrl?: string;
}

async function generateStructured<T>(params: {
  schema: z.ZodType<T>;
  system?: string;
  user: string;
  mockValue: T;
}): Promise<T> {
  if (mockMode) {
    return params.schema.parse(params.mockValue);
  }

  if (!ai) {
    throw new AppError("GEMINI_ERROR", "Gemini client is not initialized", true, 503);
  }

  const responseSchema = z.toJSONSchema(params.schema) as unknown as Record<string, unknown>;

  let lastError: AppError | null = null;

  for (let i = 0; i < STRUCTURED_PARSE_ATTEMPTS; i += 1) {
    const response = await withRetries(() =>
      ai.models.generateContent({
        model: TEXT_MODEL,
        contents: [
          {
            role: "user",
            parts: [
              ...(params.system ? [{ text: params.system }] : []),
              { text: params.user },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema,
        },
      }),
    );

    const text = responseText(response);
    if (!text) {
      lastError = new AppError("GEMINI_ERROR", "Gemini returned empty structured response", true, 502);
      continue;
    }

    const parsed = parseStructuredText(params.schema, text);
    if (parsed) {
      return parsed;
    }

    lastError = new AppError(
      "GEMINI_ERROR",
      "Gemini returned schema-incompatible structured response",
      true,
      502,
    );
  }

  throw lastError ?? new AppError("GEMINI_ERROR", "Gemini structured generation failed", true, 502);
}

export async function generateGmPrompt(settings: RoomSettings): Promise<GmPromptSchema> {
  const variation = Math.floor(Math.random() * 1_000_000);

  try {
    return await generateStructured({
      schema: gmPromptSchema,
      system: gmSystemPrompt(settings),
      user: `${gmUserPrompt(settings.aspectRatio)}\nバリエーションID: ${variation}`,
      mockValue: fallbackGmPrompt(),
    });
  } catch (error) {
    console.warn("generateGmPrompt fallback", error);
    return fallbackGmPrompt();
  }
}

export async function generateImage(params: {
  prompt: string;
  aspectRatio: AspectRatio;
  sourceImage?: GeneratedImage;
}): Promise<GeneratedImage> {
  if (mockMode) {
    return {
      mimeType: "image/png",
      directUrl: placeholderUrl(params.prompt),
    };
  }

  if (!ai) {
    throw new AppError("GEMINI_ERROR", "Gemini client is not initialized", true, 503);
  }

  const parts: Array<Record<string, unknown>> = [];
  if (params.sourceImage?.base64Data) {
    parts.push({
      inlineData: {
        data: params.sourceImage.base64Data,
        mimeType: params.sourceImage.mimeType,
      },
    });
  }
  parts.push({ text: params.prompt });

  try {
    const response = await withRetries(() =>
      ai.models.generateContent({
        model: IMAGE_MODEL,
        contents: [{ role: "user", parts }],
        config: {
          responseModalities: ["IMAGE"],
          imageConfig: {
            aspectRatio: params.aspectRatio,
          },
        },
      }),
    );

    const inlineData =
      response.data ??
      response.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData?.data;

    if (!inlineData) {
      return {
        mimeType: "image/png",
        directUrl: placeholderUrl(params.prompt),
      };
    }

    return {
      mimeType: "image/png",
      base64Data: inlineData,
    };
  } catch (error) {
    console.warn("generateImage fallback", error);
    return {
      mimeType: "image/png",
      directUrl: placeholderUrl(params.prompt),
    };
  }
}

export async function captionFromImage(
  image: GeneratedImage,
  fallbackPrompt: string,
): Promise<CaptionSchema> {
  if (mockMode || !image.base64Data) {
    try {
      return await generateStructured({
        schema: captionSchema,
        user: `${captionPrompt}\nPrompt hint: ${fallbackPrompt}`,
        mockValue: {
          scene: "A playful character in a colorful pop-art scene",
          mainSubjects: ["cat"],
          keyObjects: ["sushi", "counter", "neon lights"],
          colors: ["red", "cyan", "yellow"],
          style: "neo-brutal sticker illustration with bold outline",
          composition: "centered medium close-up",
          textInImage: null,
        },
      });
    } catch (error) {
      console.warn("captionFromImage fallback (non-image)", error);
      return fallbackCaption(fallbackPrompt);
    }
  }

  if (!ai) {
    throw new AppError("GEMINI_ERROR", "Gemini client is not initialized", true, 503);
  }

  const responseSchema = z.toJSONSchema(captionSchema) as unknown as Record<string, unknown>;

  let lastError: AppError | null = null;

  for (let i = 0; i < STRUCTURED_PARSE_ATTEMPTS; i += 1) {
    const response = await withRetries(() =>
      ai.models.generateContent({
        model: TEXT_MODEL,
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  data: image.base64Data,
                  mimeType: image.mimeType,
                },
              },
              { text: captionPrompt },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema,
        },
      }),
    );

    const text = responseText(response);
    if (!text) {
      lastError = new AppError("GEMINI_ERROR", "Gemini returned empty caption", true, 502);
      continue;
    }

    const parsed = parseStructuredText(captionSchema, text);
    if (parsed) {
      return parsed;
    }

    lastError = new AppError("GEMINI_ERROR", "Caption schema validation failed", true, 502);
  }

  console.warn("captionFromImage fallback", lastError);
  return fallbackCaption(fallbackPrompt);
}

export async function generateHint(params: {
  targetCaption: string;
  latestCaption: string;
  latestPrompt: string;
}): Promise<HintSchema> {
  try {
    return await generateStructured({
      schema: hintSchema,
      user: hintPrompt(params),
      mockValue: {
        deltaChecklist: [
          "背景に屋台の要素を追加",
          "猫の表情を自信ありに変更",
          "サーモン握りを明確化",
        ],
        improvedPrompt:
          "A confident cat eating salmon nigiri at a neon night stall, include wooden counter and lanterns, bold sticker-style outlines, high contrast pop palette, centered framing",
      },
    });
  } catch (error) {
    console.warn("generateHint fallback", error);
    return fallbackHint(params.latestPrompt);
  }
}

export async function scoreImageSimilarity(params: {
  targetImage: GeneratedImage;
  attemptImage: GeneratedImage;
  promptHint?: string;
}): Promise<VisualScoreSchema> {
  if (mockMode) {
    return fallbackVisualScore();
  }

  if (!ai) {
    throw new AppError("GEMINI_ERROR", "Gemini client is not initialized", true, 503);
  }

  if (!params.targetImage.base64Data || !params.attemptImage.base64Data) {
    return fallbackVisualScore();
  }

  const responseSchema = z.toJSONSchema(visualScoreSchema) as unknown as Record<string, unknown>;

  try {
    const response = await withRetries(() =>
      ai.models.generateContent({
        model: TEXT_MODEL,
        contents: [
          {
            role: "user",
            parts: [
              { text: "以下の2枚を比較し、見た目の類似度を0-100で採点してください。" },
              { text: "1枚目がターゲット画像です。" },
              {
                inlineData: {
                  data: params.targetImage.base64Data,
                  mimeType: params.targetImage.mimeType,
                },
              },
              { text: "2枚目がプレイヤー回答画像です。" },
              {
                inlineData: {
                  data: params.attemptImage.base64Data,
                  mimeType: params.attemptImage.mimeType,
                },
              },
              {
                text: [
                  "配点観点: 主題35, 構図20, 色調15, 背景/小物20, スタイル10。",
                  "JSONのみ返し、scoreは整数。",
                  params.promptHint ? `補足: ${params.promptHint}` : "",
                ]
                  .filter(Boolean)
                  .join("\n"),
              },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema,
        },
      }),
    );

    const text = responseText(response);
    if (!text) {
      return fallbackVisualScore();
    }

    const parsed = parseStructuredText(visualScoreSchema, text);
    return parsed ?? fallbackVisualScore();
  } catch (error) {
    console.warn("scoreImageSimilarity fallback", error);
    return fallbackVisualScore();
  }
}

export async function embedText(text: string): Promise<number[]> {
  if (mockMode) {
    return mockEmbedding(text);
  }

  if (!ai) {
    throw new AppError("GEMINI_ERROR", "Gemini client is not initialized", true, 503);
  }

  try {
    const response = await withRetries(() =>
      ai.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: [{ role: "user", parts: [{ text }] }],
      }),
    );

    const embedding = response.embeddings?.[0]?.values;
    if (!embedding || embedding.length === 0) {
      return mockEmbedding(text);
    }

    return embedding;
  } catch (error) {
    console.warn("embedText fallback", error);
    return mockEmbedding(text);
  }
}

export function imageToBuffer(image: GeneratedImage): Buffer | null {
  if (!image.base64Data) return null;
  return Buffer.from(image.base64Data, "base64");
}

export function imageToPublicUrl(image: GeneratedImage, fallbackPrompt: string): string | null {
  return image.directUrl ?? placeholderUrl(fallbackPrompt);
}
