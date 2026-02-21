import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

import { AppError } from "@/lib/utils/errors";
import { captionPrompt, gmSystemPrompt, gmUserPrompt, hintPrompt } from "@/lib/gemini/prompts";
import {
  captionSchema,
  gmPromptSchema,
  hintSchema,
  type CaptionSchema,
  type GmPromptSchema,
  type HintSchema,
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
  return {
    title: "Pop Neon Scene",
    difficulty: 3,
    tags: ["pop", "neon", "sticker"],
    prompt:
      "A colorful neo-brutal sticker-style illustration, bold black outline, high saturation palette, playful subject, clear foreground and background separation, centered composition, dramatic lighting, no text",
    negativePrompt: "text, logo, watermark, famous characters",
    mustInclude: ["bold black outline", "high saturation colors"],
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
  try {
    return await generateStructured({
      schema: gmPromptSchema,
      system: gmSystemPrompt(settings),
      user: gmUserPrompt(settings.aspectRatio),
      mockValue: {
        title: "Neon Sushi Cat",
        difficulty: 3,
        tags: ["cat", "neon", "sushi"],
        prompt:
          "A cool cat eating salmon sushi at a neon-lit night food stall, sticker illustration, bold black outlines, bright pop colors, centered composition, playful expression, dramatic rim light",
        negativePrompt: "text, logo, watermark",
        mustInclude: ["cat", "sushi", "neon sign glow"],
        mustAvoid: ["brand logo", "famous characters"],
      },
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
