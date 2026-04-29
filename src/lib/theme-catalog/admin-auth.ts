import { timingSafeEqual } from "node:crypto";

import type { NextRequest } from "next/server";

import { AppError } from "@/lib/utils/errors";

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function assertLocalAhaAdminRequest(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    throw new AppError(
      "UNAUTHORIZED",
      "Aha admin tools are only available outside production.",
      false,
      403,
    );
  }

  const expectedSecret = process.env.AHA_ADMIN_SECRET?.trim();
  if (!expectedSecret) {
    throw new AppError(
      "INTERNAL_ERROR",
      "AHA_ADMIN_SECRET is not configured.",
      false,
      503,
    );
  }

  const providedSecret =
    request.headers.get("x-aha-admin-secret")?.trim() ??
    request.nextUrl.searchParams.get("secret")?.trim() ??
    "";

  if (!providedSecret || !safeCompare(providedSecret, expectedSecret)) {
    throw new AppError("UNAUTHORIZED", "Invalid Aha admin secret.", false, 401);
  }
}
