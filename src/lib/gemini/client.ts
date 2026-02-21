import { GoogleGenAI } from "@google/genai";
import { zodToJsonSchema } from "zod-to-json-schema";
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

  const responseSchema = zodToJsonSchema(
    params.schema as unknown as Parameters<typeof zodToJsonSchema>[0],
  ) as unknown as Record<string, unknown>;

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

  const text = response.text;
  if (!text) {
    throw new AppError("GEMINI_ERROR", "Gemini returned empty structured response", true, 502);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AppError("GEMINI_ERROR", "Gemini returned non-JSON response", true, 502);
  }

  return params.schema.parse(parsed);
}

export async function generateGmPrompt(settings: RoomSettings): Promise<GmPromptSchema> {
  return generateStructured({
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

  const base64Data = response.data;
  if (!base64Data) {
    throw new AppError("GEMINI_ERROR", "Gemini did not return image data", true, 502);
  }

  return {
    mimeType: "image/png",
    base64Data,
  };
}

export async function captionFromImage(
  image: GeneratedImage,
  fallbackPrompt: string,
): Promise<CaptionSchema> {
  if (mockMode || !image.base64Data) {
    return generateStructured({
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
  }

  if (!ai) {
    throw new AppError("GEMINI_ERROR", "Gemini client is not initialized", true, 503);
  }

  const responseSchema = zodToJsonSchema(
    captionSchema as unknown as Parameters<typeof zodToJsonSchema>[0],
  ) as unknown as Record<string, unknown>;

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

  const text = response.text;
  if (!text) {
    throw new AppError("GEMINI_ERROR", "Gemini returned empty caption", true, 502);
  }

  try {
    return captionSchema.parse(JSON.parse(text));
  } catch {
    throw new AppError("GEMINI_ERROR", "Caption schema validation failed", true, 502);
  }
}

export async function generateHint(params: {
  targetCaption: string;
  latestCaption: string;
  latestPrompt: string;
}): Promise<HintSchema> {
  return generateStructured({
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
}

export async function embedText(text: string): Promise<number[]> {
  if (mockMode) {
    return mockEmbedding(text);
  }

  if (!ai) {
    throw new AppError("GEMINI_ERROR", "Gemini client is not initialized", true, 503);
  }

  const response = await withRetries(() =>
    ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: [{ role: "user", parts: [{ text }] }],
    }),
  );

  const embedding = response.embeddings?.[0]?.values;
  if (!embedding || embedding.length === 0) {
    throw new AppError("GEMINI_ERROR", "Failed to create embedding", true, 502);
  }

  return embedding;
}

export function imageToBuffer(image: GeneratedImage): Buffer | null {
  if (!image.base64Data) return null;
  return Buffer.from(image.base64Data, "base64");
}

export function imageToPublicUrl(image: GeneratedImage, fallbackPrompt: string): string | null {
  return image.directUrl ?? placeholderUrl(fallbackPrompt);
}
