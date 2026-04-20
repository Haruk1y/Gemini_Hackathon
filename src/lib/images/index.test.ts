import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGenerateGeminiImage, mockGenerateFluxImage } = vi.hoisted(() => ({
  mockGenerateGeminiImage: vi.fn(),
  mockGenerateFluxImage: vi.fn(),
}));

vi.mock("@/lib/gemini/client", () => ({
  generateImage: mockGenerateGeminiImage,
}));

vi.mock("@/lib/images/flux-vertex", () => ({
  generateFluxImage: mockGenerateFluxImage,
}));

describe("images.generateImage", () => {
  beforeEach(() => {
    vi.resetModules();
    mockGenerateGeminiImage.mockReset();
    mockGenerateFluxImage.mockReset();
  });

  it("routes gemini requests to the Gemini image provider", async () => {
    mockGenerateGeminiImage.mockResolvedValue({
      mimeType: "image/png",
      base64Data: "gemini-image",
    });

    const { generateImage } = await import("@/lib/images");
    const result = await generateImage({
      prompt: "A neon tiger",
      aspectRatio: "1:1",
      imageModel: "gemini",
    });

    expect(mockGenerateGeminiImage).toHaveBeenCalledWith({
      prompt: "A neon tiger",
      aspectRatio: "1:1",
      sourceImage: undefined,
    });
    expect(mockGenerateFluxImage).not.toHaveBeenCalled();
    expect(result.base64Data).toBe("gemini-image");
  });

  it("routes flux requests to the Vertex Flux provider", async () => {
    mockGenerateFluxImage.mockResolvedValue({
      mimeType: "image/png",
      base64Data: "flux-image",
    });

    const { generateImage } = await import("@/lib/images");
    const result = await generateImage({
      prompt: "A chrome koi fish",
      aspectRatio: "16:9",
      imageModel: "flux",
    });

    expect(mockGenerateFluxImage).toHaveBeenCalledWith({
      prompt: "A chrome koi fish",
      aspectRatio: "16:9",
      sourceImage: undefined,
    });
    expect(mockGenerateGeminiImage).not.toHaveBeenCalled();
    expect(result.base64Data).toBe("flux-image");
  });

  it("normalizes the legacy flash image model to gemini", async () => {
    mockGenerateGeminiImage.mockResolvedValue({
      mimeType: "image/png",
      base64Data: "legacy-gemini-image",
    });

    const { generateImage } = await import("@/lib/images");
    await generateImage({
      prompt: "A legacy flash prompt",
      aspectRatio: "1:1",
      imageModel: "flash",
    });

    expect(mockGenerateGeminiImage).toHaveBeenCalledTimes(1);
    expect(mockGenerateFluxImage).not.toHaveBeenCalled();
  });
});
