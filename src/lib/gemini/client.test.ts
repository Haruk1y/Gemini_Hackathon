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
};

describe("generateGmPrompt", () => {
  let randomSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    vi.resetModules();
    generateContent.mockReset();
    googleGenAICtor.mockReset();
    process.env.GEMINI_API_KEY = "test-api-key";
    delete process.env.MOCK_GEMINI;
  });

  afterEach(() => {
    randomSpy?.mockRestore();
    randomSpy = null;
    process.env.GEMINI_API_KEY = originalEnv.GEMINI_API_KEY;
    process.env.MOCK_GEMINI = originalEnv.MOCK_GEMINI;
  });

  it("builds a gm prompt shape from plain text output", async () => {
    const randomValues = [0, 0.3, 0.4, 0.5, 0.6, 0.7, 0.2, 0.1, 0.8];
    let randomIndex = 0;
    randomSpy = vi.spyOn(Math, "random").mockImplementation(() => randomValues[randomIndex++] ?? 0);
    generateContent.mockResolvedValue({
      text:
        "A floating lantern market at dusk with canal reflections, warm lights, bold outlines, high saturation, and no text",
    });

    const { generateGmPrompt } = await import("@/lib/gemini/client");
    const result = await generateGmPrompt({
      settings,
    });

    expect(googleGenAICtor).toHaveBeenCalledWith({ apiKey: "test-api-key" });
    expect(result.title).toContain("axolotl");
    expect(result.title).toContain("bizarre tool");
    expect(result.difficulty).toBe(3);
    expect(result.tags).toEqual(expect.arrayContaining(["animal", "axolotl"]));
    expect(result.prompt).toContain("floating lantern market at dusk");
    expect(result.prompt.length).toBeGreaterThanOrEqual(30);
    expect(result.prompt.length).toBeLessThanOrEqual(220);
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

    expect(result.prompt).toContain("rainy rooftop duel");
    expect(result.tags.length).toBeGreaterThanOrEqual(2);
    expect(result.prompt.length).toBeLessThanOrEqual(220);
  });

  it("falls back to a seeded prompt when Gemini returns empty prompt text", async () => {
    const randomValues = [0.2, 0.75, 0.15, 0.85, 0.4, 0.05, 0.65, 0.25, 0.55];
    let randomIndex = 0;
    randomSpy = vi.spyOn(Math, "random").mockImplementation(() => randomValues[randomIndex++] ?? 0);
    generateContent.mockResolvedValue({
      text: "   ",
    });

    const { generateGmPrompt } = await import("@/lib/gemini/client");
    const result = await generateGmPrompt({
      settings,
    });

    expect(result.prompt).toContain("vector");
    expect(result.prompt).toContain("vector illustration");
    expect(result.prompt).toContain("no text");
    expect(result.prompt.length).toBeLessThanOrEqual(220);
    expect(result.tags.length).toBeGreaterThanOrEqual(2);
  });

  it("generates varied prompts in mock mode instead of reusing one fixed challenge", async () => {
    process.env.MOCK_GEMINI = "true";
    const randomValues = [
      ...Array(9).fill(0),
      ...Array(9).fill(0.99),
    ];
    let randomIndex = 0;
    randomSpy = vi.spyOn(Math, "random").mockImplementation(() => randomValues[randomIndex++] ?? 0.99);

    const { generateGmPrompt } = await import("@/lib/gemini/client");
    const first = await generateGmPrompt({ settings });
    const second = await generateGmPrompt({ settings });

    expect(first.prompt).not.toBe(second.prompt);
    expect(first.title).not.toBe(second.title);
  });

  it("creates a broad mix of random challenge seeds", async () => {
    const { __test__ } = await import("@/lib/gemini/client");
    let state = 17;
    const nextRandom = () => {
      state = (state * 48271) % 2147483647;
      return state / 2147483647;
    };
    const signatures = new Set(
      Array.from({ length: 80 }, () => {
        const seed = __test__.createChallengeSeed(nextRandom);
        return [seed.subject, seed.setting, seed.twist, seed.composition].join("|");
      }),
    );

    expect(signatures.size).toBeGreaterThan(55);
  });

  it("keeps the visual style fixed to the vector illustration direction", async () => {
    const { __test__ } = await import("@/lib/gemini/client");
    const first = __test__.createChallengeSeed(() => 0);
    const second = __test__.createChallengeSeed(() => 0.99);

    expect(first.styleFamily).toBe(second.styleFamily);
    expect(first.styleFamily).toContain("vector illustration");
    expect(first.styleFamily).toContain("flat");
  });

  it("compresses long prompts without cutting through the middle of a word", async () => {
    const { __test__ } = await import("@/lib/gemini/client");
    const longPrompt = [
      "A clumsy shopping basket robot, its optical sensor comically stretched into an overdramatic gasp",
      "teetering precariously on a glistening, slippery stage",
      "deep within a glowing, rain-slicked alley under a harsh golden spotlight",
      "with distorted theatrical faces in the background",
      "rendered as a clean vector illustration with no text",
    ].join(", ");

    const result = __test__.compressPromptText(longPrompt, 220);

    expect(result.length).toBeLessThanOrEqual(220);
    expect(result.endsWith("rende")).toBe(false);
    expect(result).toContain("shopping basket robot");
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
