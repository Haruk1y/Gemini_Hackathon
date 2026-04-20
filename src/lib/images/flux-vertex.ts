import type { AspectRatio } from "@/lib/types/game";
import { AppError } from "@/lib/utils/errors";

import { getGoogleCloudAuthorizationHeader } from "@/lib/images/vertex-auth";
import type { GeneratedImage } from "@/lib/images/types";

const IMAGE_GENERATION_ATTEMPTS = 3;

type VertexPrediction = {
  output?: string;
  error?: string | { message?: string } | null;
};

type VertexPredictResponse = {
  predictions?: VertexPrediction[];
  error?: {
    message?: string;
    code?: number;
    status?: string;
  };
};

function getRequiredEnv(name: string): string {
  const value = process.env[name];
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

function getVertexPredictUrl(): string {
  const host = getRequiredEnv("VERTEX_ENDPOINT_HOST");
  const projectId =
    process.env.VERTEX_PROJECT_ID ??
    process.env.GCP_PROJECT_ID ??
    getRequiredEnv("VERTEX_PROJECT_ID");
  const location = getRequiredEnv("VERTEX_LOCATION");
  const endpointId = getRequiredEnv("VERTEX_ENDPOINT_ID");

  return `https://${host}/v1/projects/${projectId}/locations/${location}/endpoints/${endpointId}:predict`;
}

function parseVertexError(
  response: VertexPredictResponse,
  fallback: string,
  status: number,
): AppError {
  const predictionError = response.predictions?.[0]?.error;

  const rawMessage =
    typeof predictionError === "string"
      ? predictionError
      : predictionError?.message ??
        response.error?.message ??
        fallback;

  if (status === 401 || status === 403) {
    return new AppError(
      "GEMINI_ERROR",
      "Image generation provider permission was denied. Check the configured Vertex credentials and endpoint access.",
      false,
      status,
    );
  }

  if (status === 429) {
    return new AppError(
      "GEMINI_ERROR",
      "Image generation provider is rate limited. Please try again in a moment.",
      true,
      status,
    );
  }

  if (status >= 500) {
    return new AppError(
      "GEMINI_ERROR",
      "Image generation provider is temporarily unavailable. Please try again in a moment.",
      true,
      status,
    );
  }

  return new AppError("GEMINI_ERROR", rawMessage, false, status || 502);
}

function parseVertexPredictionError(response: VertexPredictResponse): AppError {
  const predictionError = response.predictions?.[0]?.error;
  const rawMessage =
    typeof predictionError === "string"
      ? predictionError
      : predictionError?.message ??
        response.error?.message ??
        "Image generation provider returned an error.";

  return new AppError("GEMINI_ERROR", rawMessage, false, 502);
}

async function sleep(ms: number) {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function parseJsonResponse(response: Response): Promise<VertexPredictResponse> {
  try {
    return (await response.json()) as VertexPredictResponse;
  } catch {
    return {};
  }
}

export async function generateFluxImage(params: {
  prompt: string;
  aspectRatio: AspectRatio;
  sourceImage?: GeneratedImage;
}): Promise<GeneratedImage> {
  void params.aspectRatio;

  if (params.sourceImage) {
    throw new AppError(
      "GEMINI_ERROR",
      "The configured image provider does not support source images yet.",
      false,
      400,
    );
  }

  let lastError: AppError | null = null;

  for (let attempt = 0; attempt < IMAGE_GENERATION_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(getVertexPredictUrl(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: await getGoogleCloudAuthorizationHeader(),
        },
        body: JSON.stringify({
          instances: [
            {
              prompt: params.prompt,
            },
          ],
        }),
        cache: "no-store",
      });

      const data = await parseJsonResponse(response);

      if (!response.ok) {
        const error = parseVertexError(
          data,
          "Image generation provider request failed.",
          response.status,
        );
        if (!error.retryable) {
          throw error;
        }
        lastError = error;
        await sleep(250 + attempt * 200);
        continue;
      }

      const prediction = data.predictions?.[0];
      if (prediction?.error) {
        throw parseVertexPredictionError(data);
      }

      if (!prediction?.output) {
        lastError = new AppError(
          "GEMINI_ERROR",
          "Image generation provider did not return image data.",
          true,
          502,
        );
        await sleep(250 + attempt * 200);
        continue;
      }

      return {
        mimeType: "image/png",
        base64Data: prediction.output,
      };
    } catch (error) {
      if (error instanceof AppError) {
        if (!error.retryable) {
          throw error;
        }
        lastError = error;
        await sleep(250 + attempt * 200);
        continue;
      }

      throw error;
    }
  }

  throw lastError ?? new AppError("GEMINI_ERROR", "Image generation failed", true, 502);
}
