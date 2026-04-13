import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateContent = vi.fn();
const googleGenAICtor = vi.fn();

vi.mock("@google/genai", () => ({
  GoogleGenAI: class GoogleGenAI {
    constructor(options: unknown) {
      googleGenAICtor(options);
    }

    models = {
      generateContent,
    };
  },
}));

const originalEnv = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  MOCK_GEMINI: process.env.MOCK_GEMINI,
};

const settings = {
  maxPlayers: 8,
  roundSeconds: 60,
  maxAttempts: 1,
  aspectRatio: "1:1" as const,
  imageModel: "flash" as const,
  hintLimit: 0,
  totalRounds: 3,
  gameMode: "classic" as const,
  cpuCount: 0,
};

describe("generateGmPrompt", () => {
  beforeEach(() => {
    vi.resetModules();
    generateContent.mockReset();
    googleGenAICtor.mockReset();
    process.env.GEMINI_API_KEY = "test-api-key";
    delete process.env.MOCK_GEMINI;
  });

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalEnv.GEMINI_API_KEY;
    process.env.MOCK_GEMINI = originalEnv.MOCK_GEMINI;
  });

  it("builds a gm prompt shape from plain text output", async () => {
    generateContent.mockResolvedValue({
      text:
        "A floating lantern market at dusk with canal reflections, warm lights, bold outlines, high saturation, and no text",
    });

    const { generateGmPrompt } = await import("@/lib/gemini/client");
    const result = await generateGmPrompt({
      settings,
    });

    expect(googleGenAICtor).toHaveBeenCalledWith({ apiKey: "test-api-key" });
    expect(result.title).toContain("floating lantern market");
    expect(result.difficulty).toBe(3);
    expect(result.tags).toEqual(expect.arrayContaining(["floating", "lantern", "market"]));
    expect(result.prompt).toContain("floating lantern market at dusk");
    expect(result.prompt.length).toBeGreaterThanOrEqual(30);
    expect(result.negativePrompt).toContain("watermark");
    expect(result.mustInclude).toEqual([]);
    expect(result.mustAvoid).toEqual([]);
  });

  it("accepts prompt text wrapped in markdown fences", async () => {
    generateContent.mockResolvedValue({
      text: [
        "```text",
        "A rainy rooftop duel at twilight with glossy reflections, bold outlines, high saturation, and no text",
        "```",
      ].join("\n"),
    });

    const { generateGmPrompt } = await import("@/lib/gemini/client");
    const result = await generateGmPrompt({
      settings,
    });

    expect(result.title).toContain("rainy rooftop duel");
    expect(result.tags).toEqual(expect.arrayContaining(["rainy", "rooftop", "duel"]));
  });

  it("fails when Gemini returns empty prompt text", async () => {
    generateContent.mockResolvedValue({
      text: "   ",
    });

    const { generateGmPrompt } = await import("@/lib/gemini/client");

    await expect(
      generateGmPrompt({
        settings,
      }),
    ).rejects.toMatchObject({
      code: "GEMINI_ERROR",
      message: "Gemini returned empty prompt text",
    });
  });
});

describe("captionFromImage", () => {
  beforeEach(() => {
    vi.resetModules();
    generateContent.mockReset();
    googleGenAICtor.mockReset();
    process.env.GEMINI_API_KEY = "test-api-key";
    delete process.env.MOCK_GEMINI;
  });

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalEnv.GEMINI_API_KEY;
    process.env.MOCK_GEMINI = originalEnv.MOCK_GEMINI;
  });

  it("falls back to prompt-derived caption when structured caption parsing fails", async () => {
    generateContent.mockResolvedValue({
      text: JSON.stringify({
        scene: 42,
        mainSubjects: "lantern market",
      }),
    });

    const { captionFromImage } = await import("@/lib/gemini/client");
    const result = await captionFromImage(
      {
        mimeType: "image/png",
        base64Data: Buffer.from("fake-image").toString("base64"),
      },
      "floating lantern market at dusk with canal reflections and warm lights",
    );

    expect(result.scene).toContain("Prompt-guided scene");
    expect(result.mainSubjects.length).toBeGreaterThan(0);
  });
});

describe("rewriteCpuPrompt", () => {
  beforeEach(() => {
    vi.resetModules();
    generateContent.mockReset();
    googleGenAICtor.mockReset();
    process.env.GEMINI_API_KEY = "test-api-key";
    delete process.env.MOCK_GEMINI;
  });

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalEnv.GEMINI_API_KEY;
    process.env.MOCK_GEMINI = originalEnv.MOCK_GEMINI;
  });

  it("accepts prompt-only text output for cpu rewrites", async () => {
    generateContent.mockResolvedValue({
      text: [
        "```text",
        "A sticker-like night market scene with a glowing lantern fox, teal umbrellas, bright puddle reflections, slightly off-center framing, and no text",
        "```",
      ].join("\n"),
    });

    const { rewriteCpuPrompt } = await import("@/lib/gemini/client");
    const result = await rewriteCpuPrompt({
      role: "agent",
      reconstructedPrompt:
        "night market scene, main subject: lantern fox, key objects: umbrellas, puddles, color palette: teal, gold, style: sticker illustration, composition: centered composition, no text, no watermark",
      caption: {
        scene: "A lantern fox walking through a neon night market",
        mainSubjects: ["lantern fox"],
        keyObjects: ["umbrellas", "puddles"],
        colors: ["teal", "gold"],
        style: "sticker illustration",
        composition: "centered composition",
        textInImage: null,
      },
    });

    expect(result).toContain("night market");
    expect(result).toContain("lantern fox");
    expect(result).not.toContain("```");
  });
});

describe("generateImage", () => {
  beforeEach(() => {
    vi.resetModules();
    generateContent.mockReset();
    googleGenAICtor.mockReset();
    process.env.GEMINI_API_KEY = "test-api-key";
    delete process.env.MOCK_GEMINI;
  });

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalEnv.GEMINI_API_KEY;
    process.env.MOCK_GEMINI = originalEnv.MOCK_GEMINI;
  });

  it("retries with stricter image-only instructions when the first response has no image", async () => {
    generateContent
      .mockResolvedValueOnce({
        text: "I can help refine that prompt, but here is a text response.",
      })
      .mockResolvedValueOnce({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    data: Buffer.from("fake-image").toString("base64"),
                  },
                },
              ],
            },
          },
        ],
      });

    const { generateImage } = await import("@/lib/gemini/client");
    const result = await generateImage({
      prompt: "A neon fox racing through a rainy alley",
      aspectRatio: "1:1",
    });

    expect(result.base64Data).toBe(Buffer.from("fake-image").toString("base64"));
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("accepts image data from a later candidate", async () => {
    generateContent.mockResolvedValue({
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [{ text: "first candidate text only" }],
          },
        },
        {
          finishReason: "STOP",
          content: {
            parts: [
              {
                inlineData: {
                  data: Buffer.from("candidate-two-image").toString("base64"),
                  mimeType: "image/png",
                },
              },
            ],
          },
        },
      ],
    });

    const { generateImage } = await import("@/lib/gemini/client");
    const result = await generateImage({
      prompt: "A paper dragon over a moonlit station",
      aspectRatio: "1:1",
    });

    expect(result.base64Data).toBe(Buffer.from("candidate-two-image").toString("base64"));
  });

  it("accepts image data from generatedImages payloads", async () => {
    generateContent.mockResolvedValue({
      generatedImages: [
        {
          image: {
            imageBytes: Buffer.from("generated-image").toString("base64"),
            mimeType: "image/jpeg",
          },
        },
      ],
    });

    const { generateImage } = await import("@/lib/gemini/client");
    const result = await generateImage({
      prompt: "A chrome koi fish circling a glass fountain",
      aspectRatio: "1:1",
    });

    expect(result.base64Data).toBe(Buffer.from("generated-image").toString("base64"));
    expect(result.mimeType).toBe("image/jpeg");
  });
});
