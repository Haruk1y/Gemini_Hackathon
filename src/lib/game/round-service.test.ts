import { describe, expect, it } from "vitest";

import { AppError } from "@/lib/utils/errors";

describe("round-service storage error handling", () => {
  it("maps missing client_email signing failures to GCP_ERROR", async () => {
    const error = new Error("Cannot sign data without `client_email`.");

    const { __test__ } = await import("@/lib/game/round-service");
    expect(__test__.isMissingSigningIdentityError(error)).toBe(true);
  });

  it("keeps the expected app error shape for signing guidance", async () => {
    const appError = new AppError(
      "GCP_ERROR",
      "Cloud Storage の署名付きURLを作れません。ローカル/Vercel では `GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY_JSON` を設定してください。",
      false,
      503,
    );

    expect(appError.code).toBe("GCP_ERROR");
    expect(appError.status).toBe(503);
  });
});
