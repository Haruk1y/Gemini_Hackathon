import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const verifyIdToken = vi.fn();

vi.mock("google-auth-library", () => ({
  OAuth2Client: class OAuth2Client {
    verifyIdToken = verifyIdToken;
  },
}));

const originalEnv = {
  APP_BASE_URL: process.env.APP_BASE_URL,
  SCHEDULER_OIDC_AUDIENCE: process.env.SCHEDULER_OIDC_AUDIENCE,
};

describe("verifySchedulerRequest", () => {
  beforeEach(() => {
    vi.resetModules();
    verifyIdToken.mockReset();
    delete process.env.APP_BASE_URL;
    delete process.env.SCHEDULER_OIDC_AUDIENCE;
  });

  afterEach(() => {
    process.env.APP_BASE_URL = originalEnv.APP_BASE_URL;
    process.env.SCHEDULER_OIDC_AUDIENCE = originalEnv.SCHEDULER_OIDC_AUDIENCE;
  });

  it("uses the configured scheduler audience when verifying the token", async () => {
    process.env.SCHEDULER_OIDC_AUDIENCE = "https://prompdojo.vercel.app";
    verifyIdToken.mockResolvedValue({});

    const { verifySchedulerRequest } = await import("@/lib/auth/verify-scheduler");

    await verifySchedulerRequest(
      new Request("https://preview-prompdojo.vercel.app/api/maintenance/cleanup", {
        headers: {
          authorization: "Bearer scheduler-token",
        },
      }),
    );

    expect(verifyIdToken).toHaveBeenCalledWith({
      idToken: "scheduler-token",
      audience: "https://prompdojo.vercel.app",
    });
  });

  it("falls back to APP_BASE_URL when the explicit scheduler audience is unset", async () => {
    process.env.APP_BASE_URL = "https://prompdojo.vercel.app";
    verifyIdToken.mockResolvedValue({});

    const { resolveSchedulerAudience } = await import("@/lib/auth/verify-scheduler");

    expect(
      resolveSchedulerAudience(
        new Request("https://preview-prompdojo.vercel.app/api/maintenance/cleanup"),
      ),
    ).toBe("https://prompdojo.vercel.app");
  });

  it("rejects requests without a bearer token", async () => {
    process.env.APP_BASE_URL = "https://prompdojo.vercel.app";
    const { verifySchedulerRequest } = await import("@/lib/auth/verify-scheduler");

    await expect(
      verifySchedulerRequest(
        new Request("https://prompdojo.vercel.app/api/maintenance/cleanup"),
      ),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Missing Cloud Scheduler token",
      status: 401,
    });
  });

  it("allows manual cleanup requests when scheduler protection is not configured", async () => {
    const { verifySchedulerRequest } = await import("@/lib/auth/verify-scheduler");

    await expect(
      verifySchedulerRequest(
        new Request("http://localhost:3000/api/maintenance/cleanup"),
      ),
    ).resolves.toBeUndefined();
  });
});
