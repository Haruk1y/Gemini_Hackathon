import { describe, expect, it } from "vitest";

import { toErrorResponse } from "@/lib/utils/errors";

describe("toErrorResponse", () => {
  it("maps expired ADC reauth errors to a GCP_ERROR response", async () => {
    const error = Object.assign(
      new Error("2 UNKNOWN: Getting metadata from plugin failed"),
      {
        details:
          'Getting metadata from plugin failed with error: {"error":"invalid_grant","error_subtype":"invalid_rapt"}',
      },
    );

    const response = toErrorResponse(error);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: {
        code: "GCP_ERROR",
        message: expect.stringContaining("gcloud auth application-default login"),
        retryable: false,
      },
    });
  });
});
