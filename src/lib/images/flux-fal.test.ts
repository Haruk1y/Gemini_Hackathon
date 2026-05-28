import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockFalConfig, mockFalSubscribe, MockApiError } = vi.hoisted(() => {
  class MockApiError extends Error {
    readonly status: number;
    readonly body: unknown;
    readonly requestId: string;

    constructor({
      message,
      status,
      body,
      requestId,
    }: {
      message: string;
      status: number;
      body?: unknown;
      requestId?: string;
    }) {
      super(message);
      this.status = status;
      this.body = body;
      this.requestId = requestId ?? "";
    }
  }

  return {
    mockFalConfig: vi.fn(),
    mockFalSubscribe: vi.fn(),
    MockApiError,
  };
});

vi.mock("@fal-ai/client", () => ({
  ApiError: MockApiError,
  fal: {
    config: mockFalConfig,
    subscribe: mockFalSubscribe,
  },
}));

const originalEnv = {
  FAL_KEY: process.env.FAL_KEY,
  FLUX_MODEL: process.env.FLUX_MODEL,
  FLUX_EDIT_MODEL: process.env.FLUX_EDIT_MODEL,
  FLUX_NUM_INFERENCE_STEPS: process.env.FLUX_NUM_INFERENCE_STEPS,
  FLUX_ENABLE_SAFETY_CHECKER: process.env.FLUX_ENABLE_SAFETY_CHECKER,
};

describe("generateFluxImage with fal", () => {
  beforeEach(() => {
    vi.resetModules();
    mockFalConfig.mockReset();
    mockFalSubscribe.mockReset();
    process.env.FAL_KEY = "fal-key";
    delete process.env.FLUX_MODEL;
    delete process.env.FLUX_EDIT_MODEL;
    delete process.env.FLUX_NUM_INFERENCE_STEPS;
    delete process.env.FLUX_ENABLE_SAFETY_CHECKER;
  });

  afterEach(() => {
    process.env.FAL_KEY = originalEnv.FAL_KEY;
    process.env.FLUX_MODEL = originalEnv.FLUX_MODEL;
    process.env.FLUX_EDIT_MODEL = originalEnv.FLUX_EDIT_MODEL;
    process.env.FLUX_NUM_INFERENCE_STEPS = originalEnv.FLUX_NUM_INFERENCE_STEPS;
    process.env.FLUX_ENABLE_SAFETY_CHECKER =
      originalEnv.FLUX_ENABLE_SAFETY_CHECKER;
  });

  it("generates text-to-image through the default Klein 4B endpoint", async () => {
    mockFalSubscribe.mockResolvedValue({
      data: {
        images: [{ url: "data:image/png;base64,ZmFsLWltYWdl" }],
      },
    });

    const { generateFluxImage } = await import("@/lib/images/flux-fal");
    const result = await generateFluxImage({
      prompt: "A tiny dojo made of paper",
      aspectRatio: "16:9",
    });

    expect(mockFalConfig).toHaveBeenCalledWith({ credentials: "fal-key" });
    expect(mockFalSubscribe).toHaveBeenCalledWith("fal-ai/flux-2/klein/4b", {
      input: {
        prompt: "A tiny dojo made of paper",
        image_size: { width: 1280, height: 720 },
        num_images: 1,
        num_inference_steps: 4,
        sync_mode: true,
        enable_safety_checker: true,
        output_format: "png",
      },
    });
    expect(result).toEqual({
      mimeType: "image/png",
      base64Data: "ZmFsLWltYWdl",
    });
  });

  it("uses the edit endpoint when a source image is supplied", async () => {
    process.env.FLUX_EDIT_MODEL = "fal-ai/custom/edit";
    mockFalSubscribe.mockResolvedValue({
      data: {
        images: [
          { url: "https://example.com/output.png", content_type: "image/png" },
        ],
      },
    });

    const { generateFluxImage } = await import("@/lib/images/flux-fal");
    const result = await generateFluxImage({
      prompt: "Make the lantern blue",
      aspectRatio: "1:1",
      sourceImage: {
        mimeType: "image/png",
        base64Data: "c291cmNl",
      },
    });

    expect(mockFalSubscribe).toHaveBeenCalledWith("fal-ai/custom/edit", {
      input: expect.objectContaining({
        image_size: { width: 960, height: 960 },
        image_urls: ["data:image/png;base64,c291cmNl"],
        prompt: "Make the lantern blue",
      }),
    });
    expect(result).toEqual({
      mimeType: "image/png",
      directUrl: "https://example.com/output.png",
    });
  });

  it("classifies fal permission failures", async () => {
    mockFalSubscribe.mockRejectedValue(
      new MockApiError({
        message: "unauthorized",
        status: 401,
      }),
    );

    const { generateFluxImage } = await import("@/lib/images/flux-fal");

    await expect(
      generateFluxImage({
        prompt: "A blocked request",
        aspectRatio: "1:1",
      }),
    ).rejects.toMatchObject({
      code: "GEMINI_ERROR",
      message:
        "Image generation provider permission was denied. Check FAL_KEY.",
      status: 401,
    });
  });
});
