import type { ErrorCode } from "@/lib/types/game";
import { buildCurrentApiPath } from "@/lib/client/paths";

export class ApiClientError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public retryable: boolean,
    public status: number,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export async function apiPost<T extends Record<string, unknown>>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(buildCurrentApiPath(path), {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = (await response.json().catch(() => null)) as {
    ok: boolean;
    error?: {
      code: ErrorCode;
      message: string;
      retryable: boolean;
    };
    [key: string]: unknown;
  } | null;

  if (!response.ok || !json?.ok) {
    throw new ApiClientError(
      json?.error?.code ?? "INTERNAL_ERROR",
      json?.error?.message ?? "Unexpected API error",
      json?.error?.retryable ?? false,
      response.status,
    );
  }

  return json as unknown as T;
}
