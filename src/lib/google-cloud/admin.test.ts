import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = {
  GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
  GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY_JSON: process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY_JSON,
};

describe("google cloud admin config", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY_JSON;
  });

  afterEach(() => {
    process.env.GOOGLE_CLOUD_PROJECT = originalEnv.GOOGLE_CLOUD_PROJECT;
    process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY_JSON =
      originalEnv.GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY_JSON;
  });

  it("uses service account json credentials when provided", async () => {
    process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY_JSON = JSON.stringify({
      project_id: "personal-project",
      client_email: "app@test.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n",
    });

    const { __test__ } = await import("@/lib/google-cloud/admin");
    expect(__test__.buildGoogleCloudClientOptions()).toEqual({
      projectId: "personal-project",
      credentials: {
        client_email: "app@test.iam.gserviceaccount.com",
        private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
      },
    });
  });

  it("falls back to project-only options when using ambient credentials", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "personal-project";

    const { __test__ } = await import("@/lib/google-cloud/admin");
    expect(__test__.buildGoogleCloudClientOptions()).toEqual({
      projectId: "personal-project",
    });
  });
});
