import { afterEach, describe, expect, it } from "vitest";

import { AppError } from "@/lib/utils/errors";
import { __test__ as uploadImageTest } from "@/lib/storage/upload-image";

const originalBlobToken = process.env.BLOB_READ_WRITE_TOKEN;

describe("upload-image", () => {
  afterEach(() => {
    if (originalBlobToken === undefined) {
      delete process.env.BLOB_READ_WRITE_TOKEN;
      return;
    }

    process.env.BLOB_READ_WRITE_TOKEN = originalBlobToken;
  });

  it("throws a clear error when blob token is missing", () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;

    expect(() => uploadImageTest.assertBlobTokenConfigured()).toThrow(AppError);
    expect(() => uploadImageTest.assertBlobTokenConfigured()).toThrow(
      "BLOB_READ_WRITE_TOKEN is missing",
    );
  });

  it("accepts configured blob token", () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test";

    expect(() => uploadImageTest.assertBlobTokenConfigured()).not.toThrow();
  });
});
