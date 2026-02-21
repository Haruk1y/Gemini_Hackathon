import type { ErrorCode } from "@/lib/types/game";

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
  getIdToken: () => Promise<string>,
): Promise<T> {
  const idToken = await getIdToken();

  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
  });

  const json = (await response.json()) as {
    ok: boolean;
    error?: {
      code: ErrorCode;
      message: string;
      retryable: boolean;
    };
    [key: string]: unknown;
  };

  if (!response.ok || !json.ok) {
    throw new ApiClientError(
      json.error?.code ?? "INTERNAL_ERROR",
      json.error?.message ?? "Unexpected API error",
      json.error?.retryable ?? false,
      response.status,
    );
  }

  return json as unknown as T;
}
