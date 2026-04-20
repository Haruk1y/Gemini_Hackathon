import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_ROOM_SETTINGS, mergeRoomSettings } from "@/lib/game/defaults";

describe("game defaults", () => {
  afterEach(() => {
    delete process.env.GEMINI_PROMPT_MODEL_DEFAULT;
    delete process.env.GEMINI_JUDGE_MODEL_DEFAULT;
    delete process.env.GEMINI_TEXT_MODEL;
    vi.resetModules();
  });

  it("defaults to classic single-attempt gameplay with no hints", () => {
    expect(DEFAULT_ROOM_SETTINGS.gameMode).toBe("classic");
    expect(DEFAULT_ROOM_SETTINGS.maxAttempts).toBe(1);
    expect(DEFAULT_ROOM_SETTINGS.hintLimit).toBe(0);
    expect(DEFAULT_ROOM_SETTINGS.totalRounds).toBe(1);
    expect(DEFAULT_ROOM_SETTINGS.imageModel).toBe("gemini");
    expect(DEFAULT_ROOM_SETTINGS.promptModel).toBe("flash");
    expect(DEFAULT_ROOM_SETTINGS.judgeModel).toBe("flash");
  });

  it("preserves room mode, rounds, and image model while forcing single-attempt no-hint gameplay", () => {
    const merged = mergeRoomSettings({
      gameMode: "memory",
      imageModel: "flux",
      promptModel: "flash-lite",
      judgeModel: "flash-lite",
      maxAttempts: 3,
      hintLimit: 2,
      totalRounds: 3,
    });

    expect(merged.gameMode).toBe("memory");
    expect(merged.imageModel).toBe("flux");
    expect(merged.promptModel).toBe("flash-lite");
    expect(merged.judgeModel).toBe("flash-lite");
    expect(merged.maxAttempts).toBe(1);
    expect(merged.hintLimit).toBe(0);
    expect(merged.totalRounds).toBe(3);
  });

  it("normalizes the legacy flash image model to gemini", () => {
    const merged = mergeRoomSettings({
      imageModel: "flash" as never,
    });

    expect(merged.imageModel).toBe("gemini");
  });

  it("falls back to GEMINI_TEXT_MODEL when the new defaults are unset", async () => {
    process.env.GEMINI_TEXT_MODEL = "gemini-2.5-flash-lite";
    vi.resetModules();

    const { DEFAULT_ROOM_SETTINGS: defaults } = await import("@/lib/game/defaults");

    expect(defaults.promptModel).toBe("flash-lite");
    expect(defaults.judgeModel).toBe("flash-lite");
  });
});
