import { NextResponse } from "next/server";

import type { ApiErrorResponse, ErrorCode } from "@/lib/types/game";

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public retryable = false,
    public status = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}

function extractErrorText(error: unknown): string {
  if (error instanceof Error) {
    const details =
      typeof (error as Error & { details?: unknown }).details === "string"
        ? (error as Error & { details?: string }).details
        : "";
    return `${error.message}\n${details}`.trim();
  }

  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object") {
    const details = "details" in error && typeof error.details === "string" ? error.details : "";
    const message = "message" in error && typeof error.message === "string" ? error.message : "";
    return `${message}\n${details}`.trim();
  }

  return "";
}

function normalizeExternalError(error: unknown): AppError | null {
  const text = extractErrorText(error);

  if (
    /invalid_rapt|invalid_grant|reauthentication failed|application-default login|getting metadata from plugin failed/i.test(
      text,
    )
  ) {
    return new AppError(
      "GCP_ERROR",
      "Google Cloud 認証の期限が切れています。`gcloud auth application-default login` を実行してから再試行してください。",
      false,
      503,
    );
  }

  return null;
}

export function toErrorResponse(error: unknown): NextResponse<ApiErrorResponse> {
  if (error instanceof AppError) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
        },
      },
      { status: error.status },
    );
  }

  const normalized = normalizeExternalError(error);
  if (normalized) {
    return toErrorResponse(normalized);
  }

  console.error("Unhandled API error", error);

  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Unexpected server error",
        retryable: true,
      },
    },
    { status: 500 },
  );
}

export function assert(condition: unknown, error: AppError): asserts condition {
  if (!condition) {
    throw error;
  }
}

export const __test__ = {
  extractErrorText,
  normalizeExternalError,
};
