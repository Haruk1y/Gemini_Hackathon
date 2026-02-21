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
