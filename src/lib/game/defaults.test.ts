import { describe, expect, it } from "vitest";

import { DEFAULT_ROOM_SETTINGS, mergeRoomSettings } from "@/lib/game/defaults";

describe("game defaults", () => {
  it("defaults to classic single-attempt gameplay with no hints", () => {
    expect(DEFAULT_ROOM_SETTINGS.gameMode).toBe("classic");
    expect(DEFAULT_ROOM_SETTINGS.maxAttempts).toBe(1);
    expect(DEFAULT_ROOM_SETTINGS.hintLimit).toBe(0);
    expect(DEFAULT_ROOM_SETTINGS.totalRounds).toBe(1);
    expect(DEFAULT_ROOM_SETTINGS.imageModel).toBe("gemini");
  });

  it("preserves room mode, rounds, and image model while forcing single-attempt no-hint gameplay", () => {
    const merged = mergeRoomSettings({
      gameMode: "memory",
      imageModel: "flux",
      maxAttempts: 3,
      hintLimit: 2,
      totalRounds: 3,
    });

    expect(merged.gameMode).toBe("memory");
    expect(merged.imageModel).toBe("flux");
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
});
