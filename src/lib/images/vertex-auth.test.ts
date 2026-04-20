import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockExternalAccountFromJSON,
  mockGoogleAuthGetClient,
  mockGetVercelOidcToken,
  mockJwtConstructor,
  mockJwtGetRequestHeaders,
} = vi.hoisted(() => ({
  mockExternalAccountFromJSON: vi.fn(),
  mockGoogleAuthGetClient: vi.fn(),
  mockGetVercelOidcToken: vi.fn(),
  mockJwtConstructor: vi.fn(),
  mockJwtGetRequestHeaders: vi.fn(),
}));

vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: mockGetVercelOidcToken,
}));

vi.mock("google-auth-library", () => ({
  ExternalAccountClient: {
    fromJSON: mockExternalAccountFromJSON,
  },
  GoogleAuth: class GoogleAuth {
    getClient = mockGoogleAuthGetClient;
  },
  JWT: class JWT {
    constructor(...args: unknown[]) {
      mockJwtConstructor(...args);
    }

    getRequestHeaders = mockJwtGetRequestHeaders;
  },
}));

const originalEnv = {
  GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY_JSON:
    process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY_JSON,
  GCP_PROJECT_NUMBER: process.env.GCP_PROJECT_NUMBER,
  GCP_SERVICE_ACCOUNT_EMAIL: process.env.GCP_SERVICE_ACCOUNT_EMAIL,
  GCP_WORKLOAD_IDENTITY_POOL_ID: process.env.GCP_WORKLOAD_IDENTITY_POOL_ID,
  GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID:
    process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID,
};

describe("vertex-auth", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExternalAccountFromJSON.mockReset();
    mockGoogleAuthGetClient.mockReset();
    mockGetVercelOidcToken.mockReset();
    mockJwtConstructor.mockReset();
    mockJwtGetRequestHeaders.mockReset();
    delete process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY_JSON;
    delete process.env.GCP_PROJECT_NUMBER;
    delete process.env.GCP_SERVICE_ACCOUNT_EMAIL;
    delete process.env.GCP_WORKLOAD_IDENTITY_POOL_ID;
    delete process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID;
  });

  afterEach(() => {
    process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY_JSON =
      originalEnv.GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY_JSON;
    process.env.GCP_PROJECT_NUMBER = originalEnv.GCP_PROJECT_NUMBER;
    process.env.GCP_SERVICE_ACCOUNT_EMAIL =
      originalEnv.GCP_SERVICE_ACCOUNT_EMAIL;
    process.env.GCP_WORKLOAD_IDENTITY_POOL_ID =
      originalEnv.GCP_WORKLOAD_IDENTITY_POOL_ID;
    process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID =
      originalEnv.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID;
  });

  it("uses service account JSON when configured", async () => {
    process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY_JSON = JSON.stringify({
      client_email: "vertex-ai-caller@example-project.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
    });
    mockJwtGetRequestHeaders.mockResolvedValue(
      new Headers({
        authorization: "Bearer sa-token",
      }),
    );

    const { getGoogleCloudAuthorizationHeader } = await import(
      "@/lib/images/vertex-auth"
    );
    const header = await getGoogleCloudAuthorizationHeader();

    expect(mockJwtConstructor).toHaveBeenCalledWith({
      email: "vertex-ai-caller@example-project.iam.gserviceaccount.com",
      key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    expect(mockExternalAccountFromJSON).not.toHaveBeenCalled();
    expect(mockGoogleAuthGetClient).not.toHaveBeenCalled();
    expect(header).toBe("Bearer sa-token");
  });

  it("uses Workload Identity Federation when Vercel WIF env vars are configured", async () => {
    process.env.GCP_PROJECT_NUMBER = "123456789";
    process.env.GCP_SERVICE_ACCOUNT_EMAIL =
      "vercel-vertex@example-project.iam.gserviceaccount.com";
    process.env.GCP_WORKLOAD_IDENTITY_POOL_ID = "vercel";
    process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID = "vercel";

    mockExternalAccountFromJSON.mockReturnValue({
      getRequestHeaders: vi.fn().mockResolvedValue(
        new Headers({
          authorization: "Bearer wif-token",
        }),
      ),
    });

    const { getGoogleCloudAuthorizationHeader } = await import(
      "@/lib/images/vertex-auth"
    );
    const header = await getGoogleCloudAuthorizationHeader();

    expect(mockExternalAccountFromJSON).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "external_account",
        audience:
          "//iam.googleapis.com/projects/123456789/locations/global/workloadIdentityPools/vercel/providers/vercel",
      }),
    );
    expect(mockGoogleAuthGetClient).not.toHaveBeenCalled();
    expect(header).toBe("Bearer wif-token");
  });

  it("falls back to ADC when Vercel WIF env vars are absent", async () => {
    mockGoogleAuthGetClient.mockResolvedValue({
      getRequestHeaders: vi.fn().mockResolvedValue(
        new Headers({
          authorization: "Bearer adc-token",
        }),
      ),
    });

    const { getGoogleCloudAuthorizationHeader } = await import(
      "@/lib/images/vertex-auth"
    );
    const header = await getGoogleCloudAuthorizationHeader();

    expect(mockExternalAccountFromJSON).not.toHaveBeenCalled();
    expect(mockGoogleAuthGetClient).toHaveBeenCalledTimes(1);
    expect(header).toBe("Bearer adc-token");
  });

  it("normalizes ADC auth failures into GCP_ERROR", async () => {
    mockGoogleAuthGetClient.mockRejectedValue(
      new Error("Could not load the default credentials"),
    );

    const { getGoogleCloudAuthorizationHeader } = await import(
      "@/lib/images/vertex-auth"
    );

    await expect(getGoogleCloudAuthorizationHeader()).rejects.toMatchObject({
      code: "GCP_ERROR",
      status: 503,
    });
  });

  it("returns GCP_ERROR when service account JSON is invalid", async () => {
    process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY_JSON = "{";

    const { getGoogleCloudAuthorizationHeader } = await import(
      "@/lib/images/vertex-auth"
    );

    await expect(getGoogleCloudAuthorizationHeader()).rejects.toMatchObject({
      code: "GCP_ERROR",
      status: 503,
    });
  });
});
