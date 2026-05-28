import { ApiError, fal } from "@fal-ai/client";

import type { AspectRatio } from "@/lib/types/game";
import { AppError } from "@/lib/utils/errors";

import type { GeneratedImage } from "@/lib/images/types";

const DEFAULT_TEXT_TO_IMAGE_MODEL = "fal-ai/flux-2/klein/4b";
const DEFAULT_IMAGE_TO_IMAGE_MODEL = "fal-ai/flux-2/klein/4b/edit";
const DEFAULT_INFERENCE_STEPS = 4;

type FalImage = {
  url?: string;
  content_type?: string;
};

type FalImageResponse = {
  images?: FalImage[];
};

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new AppError(
      "GEMINI_ERROR",
      `Image generation provider is missing configuration: ${name}`,
      false,
      503,
    );
  }
  return value;
}

function resolveTextToImageModel(): string {
  return process.env.FLUX_MODEL?.trim() || DEFAULT_TEXT_TO_IMAGE_MODEL;
}

function resolveImageToImageModel(): string {
  return process.env.FLUX_EDIT_MODEL?.trim() || DEFAULT_IMAGE_TO_IMAGE_MODEL;
}

function resolveInferenceSteps(): number {
  const raw = Number.parseInt(process.env.FLUX_NUM_INFERENCE_STEPS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_INFERENCE_STEPS;
}

function resolveFalImageSize(aspectRatio: AspectRatio) {
  if (aspectRatio === "16:9") {
    return { width: 1280, height: 720 };
  }

  if (aspectRatio === "9:16") {
    return { width: 720, height: 1280 };
  }

  return { width: 960, height: 960 };
}

function sourceImageToUrl(image: GeneratedImage): string | null {
  if (image.directUrl) {
    return image.directUrl;
  }

  if (image.base64Data) {
    return `data:${image.mimeType};base64,${image.base64Data}`;
  }

  return null;
}

function parseDataImageUrl(url: string): GeneratedImage | null {
  const match = url.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) {
    return null;
  }

  return {
    mimeType: match[1] ?? "image/png",
    base64Data: match[2] ?? "",
  };
}

function parseFalImage(image: FalImage | undefined): GeneratedImage {
  if (!image?.url) {
    throw new AppError(
      "GEMINI_ERROR",
      "Image generation provider did not return image data.",
      true,
      502,
    );
  }

  const dataImage = parseDataImageUrl(image.url);
  if (dataImage) {
    return dataImage;
  }

  return {
    mimeType: image.content_type ?? "image/png",
    directUrl: image.url,
  };
}

function normalizeFalError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) {
      return new AppError(
        "GEMINI_ERROR",
        "Image generation provider permission was denied. Check FAL_KEY.",
        false,
        error.status,
      );
    }

    if (error.status === 429) {
      return new AppError(
        "GEMINI_ERROR",
        "Image generation provider is rate limited. Please try again in a moment.",
        true,
        error.status,
      );
    }

    if (error.status >= 500) {
      return new AppError(
        "GEMINI_ERROR",
        "Image generation provider is temporarily unavailable. Please try again in a moment.",
        true,
        error.status,
      );
    }

    return new AppError(
      "GEMINI_ERROR",
      error.message,
      false,
      error.status || 502,
    );
  }

  return new AppError(
    "GEMINI_ERROR",
    error instanceof Error ? error.message : "Image generation failed",
    true,
    502,
  );
}

export async function generateFluxImage(params: {
  prompt: string;
  aspectRatio: AspectRatio;
  sourceImage?: GeneratedImage;
}): Promise<GeneratedImage> {
  fal.config({
    credentials: getRequiredEnv("FAL_KEY"),
  });

  const input = {
    prompt: params.prompt,
    image_size: resolveFalImageSize(params.aspectRatio),
    num_images: 1,
    num_inference_steps: resolveInferenceSteps(),
    sync_mode: true,
    enable_safety_checker: process.env.FLUX_ENABLE_SAFETY_CHECKER !== "false",
    output_format: "png",
  };

  try {
    const sourceImageUrl = params.sourceImage
      ? sourceImageToUrl(params.sourceImage)
      : null;

    if (params.sourceImage && !sourceImageUrl) {
      throw new AppError(
        "GEMINI_ERROR",
        "The source image is missing image data.",
        false,
        400,
      );
    }

    const result = sourceImageUrl
      ? await fal.subscribe(resolveImageToImageModel(), {
          input: {
            ...input,
            image_urls: [sourceImageUrl],
          },
        })
      : await fal.subscribe(resolveTextToImageModel(), {
          input,
        });

    return parseFalImage((result.data as FalImageResponse).images?.[0]);
  } catch (error) {
    throw normalizeFalError(error);
  }
}
