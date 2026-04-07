import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

import {
  buildPromptFromChallengeSeed,
  createChallengeSeed,
  type ChallengeSeed,
} from "@/lib/gemini/challenge-seed";
import { AppError } from "@/lib/utils/errors";
import {
  captionPrompt,
  gmSystemPrompt,
  gmUserPrompt,
} from "@/lib/gemini/prompts";
import {
  captionSchema,
  gmPromptSchema,
  visualScoreSchema,
  type CaptionSchema,
  type GmPromptSchema,
  type VisualScoreSchema,
} from "@/lib/gemini/schemas";
import type { AspectRatio, RoomSettings } from "@/lib/types/game";

const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL ?? "gemini-2.5-flash";
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image";
const STRUCTURED_PARSE_ATTEMPTS = 2;
const IMAGE_GENERATION_ATTEMPTS = 3;
const GM_PROMPT_ATTEMPTS = 2;
const GM_PROMPT_MAX_LENGTH = 220;
const TOKEN_STOPWORDS = new Set(["a", "an", "the"]);
const DEFAULT_NEGATIVE_PROMPT =
  "logo, watermark, text, brand name, famous character, trademark";
const mockMode = process.env.MOCK_GEMINI === "true" || !process.env.GEMINI_API_KEY;

function createClient(): GoogleGenAI | null {
  if (mockMode) {
    return null;
  }

  if (process.env.GEMINI_API_KEY) {
    return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  return null;
}

let ai: GoogleGenAI | null | undefined;

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

function parseJsonPayloads(text: string): unknown[] {
  const candidates: string[] = [];
  const trimmed = text.trim();

  const pushCandidate = (candidate: string | null | undefined) => {
    const next = candidate?.trim();
    if (!next || candidates.includes(next)) return;
    candidates.push(next);
  };

  pushCandidate(trimmed);

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  pushCandidate(fencedMatch?.[1]);

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    pushCandidate(trimmed.slice(objectStart, objectEnd + 1));
  }

  const arrayStart = trimmed.indexOf("[");
  const arrayEnd = trimmed.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    pushCandidate(trimmed.slice(arrayStart, arrayEnd + 1));
  }

  return candidates.flatMap((candidate) => {
    try {
      return [JSON.parse(candidate)];
    } catch {
      return [];
    }
  });
}

function normalizeText(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").replace(/^[`"'“”]+|[`"'“”]+$/g, "").trim().slice(0, maxLength);
}

function normalizeLooseText(value: string): string {
  return value.replace(/\s+/g, " ").replace(/^[`"'“”]+|[`"'“”]+$/g, "").trim();
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeText(value, 80);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function promptKeywords(prompt: string): string[] {
  return prompt
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .filter((token) => token.length > 2)
    .filter((token) => !TOKEN_STOPWORDS.has(token))
    .slice(0, 6);
}

function extractPromptText(text: string): string | null {
  const fenced = text.match(/```(?:text)?\s*([\s\S]*?)```/i)?.[1] ?? text;
  const withoutPrefix = fenced.replace(/^prompt\s*:\s*/i, "").trim();
  const normalized = normalizeLooseText(withoutPrefix);
  return normalized.length > 0 ? normalized : null;
}

function trimPromptAtBoundary(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const slice = value.slice(0, maxLength + 1);
  const punctuationBreak = Math.max(
    slice.lastIndexOf(", "),
    slice.lastIndexOf("; "),
    slice.lastIndexOf(". "),
  );
  if (punctuationBreak >= Math.floor(maxLength * 0.55)) {
    return slice.slice(0, punctuationBreak).replace(/[,\s;:.!?]+$/g, "").trim();
  }

  const wordBreak = slice.lastIndexOf(" ");
  if (wordBreak >= Math.floor(maxLength * 0.55)) {
    return slice.slice(0, wordBreak).replace(/[,\s;:.!?]+$/g, "").trim();
  }

  return value.slice(0, maxLength).replace(/[,\s;:.!?]+$/g, "").trim();
}

function compressPromptText(value: string, maxLength: number): string {
  const normalized = normalizeLooseText(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  const clauses = normalized
    .split(/\s*(?:,|;|\.(?=\s|$))\s*/g)
    .map((clause) => clause.trim())
    .filter(Boolean);

  if (clauses.length > 1) {
    let compact = "";
    for (const clause of clauses) {
      const next = compact ? `${compact}, ${clause}` : clause;
      if (next.length > maxLength) {
        break;
      }
      compact = next;
    }

    if (compact.length >= 30) {
      return compact;
    }
  }

  return trimPromptAtBoundary(normalized, maxLength);
}

function parseStructuredText<T>(
  schema: z.ZodType<T>,
  text: string,
  coerce?: (candidate: unknown) => T | null,
): T | null {
  for (const parsed of parseJsonPayloads(text)) {
    for (const candidate of buildStructuredCandidates(parsed)) {
      const result = schema.safeParse(candidate);
      if (result.success) {
        return result.data;
      }

      const normalized = coerce?.(candidate);
      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}

function responseText(response: {
  text?: string;
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}): string | null {
  const direct = response.text?.trim();
  if (direct) return direct;

  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const combined = parts
    .map((part) => part.text ?? "")
    .join("")
    .trim();

  return combined || null;
}

function placeholderUrl(prompt: string): string {
  const text = encodeURIComponent(prompt.slice(0, 60));
  return `https://placehold.co/1024x1024/FFF7E6/101010/png?text=${text}`;
}

function buildSeedTitle(seed: ChallengeSeed): string {
  return normalizeText(`${seed.subject} / ${seed.twist}`, 80) || "Generated Challenge";
}

function seedTags(seed: ChallengeSeed): string[] {
  return [
    seed.subjectCategory,
    seed.subject,
    seed.setting,
    seed.twist,
    seed.styleFamily,
    seed.lightingColor,
  ];
}

function buildGmPromptFromSeed(
  seed: ChallengeSeed,
  aspectRatio: AspectRatio,
  promptText?: string | null,
): GmPromptSchema {
  const fallbackPrompt = compressPromptText(
    buildPromptFromChallengeSeed(seed),
    GM_PROMPT_MAX_LENGTH,
  );
  const promptCandidate = promptText
    ? compressPromptText(promptText, GM_PROMPT_MAX_LENGTH)
    : fallbackPrompt;
  const prompt = promptCandidate.length >= 30 ? promptCandidate : fallbackPrompt;
  const tags = uniqueStrings([
    ...seedTags(seed),
    ...promptKeywords(prompt),
    aspectRatio.replace(":", "x"),
  ]).slice(0, 6);

  return gmPromptSchema.parse({
    title: buildSeedTitle(seed),
    difficulty: 3,
    tags: tags.length >= 2 ? tags : [seed.subjectCategory, aspectRatio.replace(":", "x")],
    prompt,
    negativePrompt: DEFAULT_NEGATIVE_PROMPT,
    mustInclude: [],
    mustAvoid: [],
  });
}

function fallbackCaption(fallbackPrompt: string): CaptionSchema {
  const tokens = fallbackPrompt
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .filter((token) => !TOKEN_STOPWORDS.has(token))
    .filter((token) => token.length > 1)
    .slice(0, 8);

  const mainSubjects = tokens.slice(0, 2);
  const keyObjects = tokens.slice(2, 6);
  const sceneKeywords = mainSubjects.length > 0 ? mainSubjects.join(" and ") : "subject";
  const scene = `Prompt-guided scene featuring ${sceneKeywords}`.slice(0, 240);

  return {
    scene,
    mainSubjects: mainSubjects.length > 0 ? mainSubjects : ["subject"],
    keyObjects,
    colors: ["vivid", "high-contrast"],
    style: "neo-brutal sticker illustration",
    composition: "centered composition",
    textInImage: null,
  };
}

function mockVisualScore(): VisualScoreSchema {
  return {
    score: 50,
    matchedElements: [],
    missingElements: [],
    note: "mock visual scoring",
  };
}

function extractInlineData(data: unknown): string | null {
  if (!data) return null;
  if (typeof data === "string") return data;
  if (data instanceof Uint8Array) {
    return Buffer.from(data).toString("base64");
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("base64");
  }
  return null;
}

function extractImageResponse(response: {
  data?: unknown;
  generatedImages?: Array<{
    image?: { imageBytes?: string; mimeType?: string };
  }>;
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: Array<{
        inlineData?: { data?: unknown; mimeType?: string };
        fileData?: { fileUri?: string; mimeType?: string };
      }>;
    };
  }>;
}): GeneratedImage | null {
  const topLevelInlineData = extractInlineData(response.data);
  if (topLevelInlineData) {
    return {
      mimeType: "image/png",
      base64Data: topLevelInlineData,
    };
  }

  const generatedImage = response.generatedImages?.find((item) => item.image?.imageBytes)?.image;
  if (generatedImage?.imageBytes) {
    return {
      mimeType: generatedImage.mimeType ?? "image/png",
      base64Data: generatedImage.imageBytes,
    };
  }

  for (const candidate of response.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const inlineData = extractInlineData(part.inlineData?.data);
      if (inlineData) {
        return {
          mimeType: part.inlineData?.mimeType ?? "image/png",
          base64Data: inlineData,
        };
      }

      const fileUri = part.fileData?.fileUri;
      if (typeof fileUri === "string" && /^https?:\/\//i.test(fileUri)) {
        return {
          mimeType: part.fileData?.mimeType ?? "image/png",
          directUrl: fileUri,
        };
      }
    }
  }

  return null;
}

function imageGenerationErrorMessage(response: {
  promptFeedback?: { blockReason?: string };
  candidates?: Array<{ finishReason?: string }>;
  text?: string;
}): string {
  if (response.promptFeedback?.blockReason) {
    return "画像生成がブロックされました。表現を少し変えて再試行してください。";
  }

  const finishReasons = (response.candidates ?? [])
    .map((candidate) => candidate.finishReason)
    .filter((reason): reason is string => typeof reason === "string");

  if (finishReasons.some((reason) => reason === "SAFETY" || reason === "IMAGE_SAFETY")) {
    return "画像生成が安全フィルタで止まりました。表現を少し変えて再試行してください。";
  }

  if (response.text?.trim()) {
    return "画像ではなくテキスト応答が返りました。少し待って再試行してください。";
  }

  return "Gemini did not return image data";
}

function getAiClient(): GoogleGenAI {
  if (ai === undefined) {
    ai = createClient();
  }
  if (!ai) {
    throw new AppError("GEMINI_ERROR", "Gemini client is not initialized", true, 503);
  }
  return ai;
}

export interface GeneratedImage {
  mimeType: string;
  base64Data?: string;
  directUrl?: string;
}

export async function generateGmPrompt(params: {
  settings: RoomSettings;
}): Promise<GmPromptSchema> {
  const seed = createChallengeSeed();
  const seedPrompt = buildPromptFromChallengeSeed(seed);

  if (mockMode) {
    return buildGmPromptFromSeed(seed, params.settings.aspectRatio);
  }

  const client = getAiClient();
  let lastError: AppError | null = null;

  for (let i = 0; i < GM_PROMPT_ATTEMPTS; i += 1) {
    try {
      const response = await withRetries(() =>
        client.models.generateContent({
          model: TEXT_MODEL,
          contents: [
            {
              role: "user",
              parts: [
                { text: gmSystemPrompt(params.settings) },
                {
                  text: gmUserPrompt({
                    aspectRatio: params.settings.aspectRatio,
                    seed,
                    seedPrompt,
                  }),
                },
              ],
            },
          ],
        }),
      );

      const text = responseText(response);
      const promptText = text ? extractPromptText(text) : null;
      if (promptText) {
        return buildGmPromptFromSeed(seed, params.settings.aspectRatio, promptText);
      }

      console.warn("Plain gm prompt generation failed", {
        attempt: i + 1,
        seed,
        text: text?.slice(0, 400) ?? null,
      });
      lastError = new AppError("GEMINI_ERROR", "Gemini returned empty prompt text", true, 502);
    } catch (error) {
      console.warn("GM prompt generation falling back to local seed prompt", {
        attempt: i + 1,
        seed,
        error: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof AppError) {
        lastError = error;
        continue;
      }
      lastError = new AppError("GEMINI_ERROR", "Gemini prompt generation failed", true, 502);
    }
  }

  if (lastError) {
    console.warn("Using local seeded GM prompt fallback", {
      seed,
      reason: lastError.message,
    });
  }

  return buildGmPromptFromSeed(seed, params.settings.aspectRatio);
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

  const client = getAiClient();
  const promptVariants = [
    params.prompt,
    `${params.prompt}\n\nUse a clean vector illustration look with bold outlines and flat colors. The image itself must contain absolutely no text, letters, numbers, signs, labels, captions, speech bubbles, or logos. Return only the generated image.`,
    `${params.prompt}\n\nReturn exactly one generated image. Keep it as a crisp vector-style illustration with flat cel-shaded colors, bold outlines, and minimal texture. Absolutely no text, letters, numbers, symbols, signage, labels, UI elements, speech bubbles, or logos.`,
  ];
  let lastError: AppError | null = null;

  for (let i = 0; i < IMAGE_GENERATION_ATTEMPTS; i += 1) {
    const parts: Array<Record<string, unknown>> = [];
    if (params.sourceImage?.base64Data) {
      parts.push({
        inlineData: {
          data: params.sourceImage.base64Data,
          mimeType: params.sourceImage.mimeType,
        },
      });
    }
    parts.push({ text: promptVariants[i] ?? params.prompt });

    try {
      const response = await withRetries(() =>
        client.models.generateContent({
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

      const generatedImage = extractImageResponse(response);
      if (generatedImage) {
        return generatedImage;
      }

      const responsePreview = responseText(response);
      console.warn("generateImage empty image response", {
        attempt: i + 1,
        prompt: params.prompt.slice(0, 160),
        finishReasons: (response.candidates ?? []).map((candidate) => candidate.finishReason),
        blockReason: response.promptFeedback?.blockReason ?? null,
        responsePreview: responsePreview?.slice(0, 240) ?? null,
      });
      lastError = new AppError(
        "GEMINI_ERROR",
        imageGenerationErrorMessage(response),
        true,
        502,
      );
      await sleep(250 + i * 150);
    } catch (error) {
      console.error("generateImage failed", error);
      if (error instanceof AppError) {
        lastError = error;
        await sleep(250 + i * 150);
        continue;
      }
      throw new AppError("GEMINI_ERROR", "Image generation failed", true, 502);
    }
  }

  throw lastError ?? new AppError("GEMINI_ERROR", "Image generation failed", true, 502);
}

export async function captionFromImage(
  image: GeneratedImage,
  fallbackPrompt: string,
): Promise<CaptionSchema> {
  if (mockMode) {
    return fallbackCaption(fallbackPrompt);
  }

  if (!image.base64Data) {
    throw new AppError("GEMINI_ERROR", "Caption input image is missing binary data", true, 502);
  }

  const client = getAiClient();
  const responseSchema = z.toJSONSchema(captionSchema) as unknown as Record<string, unknown>;
  let lastError: AppError | null = null;

  for (let i = 0; i < STRUCTURED_PARSE_ATTEMPTS; i += 1) {
    const response = await withRetries(() =>
      client.models.generateContent({
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

  console.warn("captionFromImage fallback", {
    error: lastError?.message ?? "Caption generation failed",
    prompt: fallbackPrompt.slice(0, 160),
  });
  return fallbackCaption(fallbackPrompt);
}

export async function scoreImageSimilarity(params: {
  targetImage: GeneratedImage;
  attemptImage: GeneratedImage;
}): Promise<VisualScoreSchema> {
  if (mockMode) {
    return mockVisualScore();
  }

  if (!params.targetImage.base64Data || !params.attemptImage.base64Data) {
    throw new AppError("GEMINI_ERROR", "Visual judge input images are incomplete", true, 502);
  }

  const client = getAiClient();
  const responseSchema = z.toJSONSchema(visualScoreSchema) as unknown as Record<string, unknown>;
  let lastError: AppError | null = null;

  for (let i = 0; i < STRUCTURED_PARSE_ATTEMPTS; i += 1) {
    const response = await withRetries(() =>
      client.models.generateContent({
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
                ].join("\n"),
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
      lastError = new AppError("GEMINI_ERROR", "Gemini returned empty visual score", true, 502);
      continue;
    }

    const parsed = parseStructuredText(visualScoreSchema, text);
    if (parsed) {
      return parsed;
    }

    lastError = new AppError("GEMINI_ERROR", "Visual score schema validation failed", true, 502);
  }

  throw lastError ?? new AppError("GEMINI_ERROR", "Visual scoring failed", true, 502);
}

export function imageToBuffer(image: GeneratedImage): Buffer | null {
  if (!image.base64Data) return null;
  return Buffer.from(image.base64Data, "base64");
}

export function imageToPublicUrl(image: GeneratedImage, fallbackPrompt: string): string | null {
  if (image.directUrl) {
    return image.directUrl;
  }

  if (mockMode) {
    return placeholderUrl(fallbackPrompt);
  }

  return null;
}

export const __test__ = {
  buildGmPromptFromSeed,
  buildSeedTitle,
  compressPromptText,
  createChallengeSeed,
};
