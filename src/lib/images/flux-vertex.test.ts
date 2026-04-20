import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetGoogleCloudAuthorizationHeader } = vi.hoisted(() => ({
  mockGetGoogleCloudAuthorizationHeader: vi.fn(),
}));

vi.mock("@/lib/images/vertex-auth", () => ({
  getGoogleCloudAuthorizationHeader: mockGetGoogleCloudAuthorizationHeader,
}));

const originalEnv = {
  VERTEX_PROJECT_ID: process.env.VERTEX_PROJECT_ID,
  VERTEX_LOCATION: process.env.VERTEX_LOCATION,
  VERTEX_ENDPOINT_ID: process.env.VERTEX_ENDPOINT_ID,
  VERTEX_ENDPOINT_HOST: process.env.VERTEX_ENDPOINT_HOST,
};

describe("generateFluxImage", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    mockGetGoogleCloudAuthorizationHeader.mockReset();
    mockGetGoogleCloudAuthorizationHeader.mockResolvedValue("Bearer flux-token");
    process.env.VERTEX_PROJECT_ID = "91574790771";
    process.env.VERTEX_LOCATION = "asia-southeast1";
    process.env.VERTEX_ENDPOINT_ID = "endpoint-id";
    process.env.VERTEX_ENDPOINT_HOST = "endpoint-host.prediction.vertexai.goog";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    process.env.VERTEX_PROJECT_ID = originalEnv.VERTEX_PROJECT_ID;
    process.env.VERTEX_LOCATION = originalEnv.VERTEX_LOCATION;
    process.env.VERTEX_ENDPOINT_ID = originalEnv.VERTEX_ENDPOINT_ID;
    process.env.VERTEX_ENDPOINT_HOST = originalEnv.VERTEX_ENDPOINT_HOST;
  });

  it("returns a PNG image when Vertex responds with base64 output", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            predictions: [
              {
                output: "vertex-base64-output",
              },
            ],
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      ),
    );

    const { generateFluxImage } = await import("@/lib/images/flux-vertex");
    const result = await generateFluxImage({
      prompt: "A cat waving a sign",
      aspectRatio: "1:1",
    });

    expect(result).toEqual({
      mimeType: "image/png",
      base64Data: "vertex-base64-output",
    });
  });

  it("fails when Vertex returns a prediction error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            predictions: [
              {
                error: "provider denied",
              },
            ],
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      ),
    );

    const { generateFluxImage } = await import("@/lib/images/flux-vertex");

    await expect(
      generateFluxImage({
        prompt: "A blocked image",
        aspectRatio: "1:1",
      }),
    ).rejects.toMatchObject({
      code: "GEMINI_ERROR",
      message: "provider denied",
    });
  });

  it("retries when Vertex returns an empty output payload", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          predictions: [{}],
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { generateFluxImage } = await import("@/lib/images/flux-vertex");
    const expectation = expect(
      generateFluxImage({
        prompt: "A blank image response",
        aspectRatio: "1:1",
      }),
    ).rejects.toMatchObject({
      code: "GEMINI_ERROR",
      message: "Image generation provider did not return image data.",
    });

    await vi.runAllTimersAsync();

    await expectation;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("propagates Google Cloud auth failures", async () => {
    mockGetGoogleCloudAuthorizationHeader.mockRejectedValue({
      code: "GCP_ERROR",
      message: "Google Cloud auth expired",
      status: 503,
    });
    vi.stubGlobal("fetch", vi.fn());

    const { generateFluxImage } = await import("@/lib/images/flux-vertex");

    await expect(
      generateFluxImage({
        prompt: "A failing auth request",
        aspectRatio: "1:1",
      }),
    ).rejects.toMatchObject({
      code: "GCP_ERROR",
      status: 503,
    });
  });
});
