import { describe, expect, it } from "vitest";

import { DEFAULT_ROOM_SETTINGS, mergeRoomSettings } from "@/lib/game/defaults";

describe("game defaults", () => {
  it("defaults to classic single-attempt gameplay with no hints", () => {
    expect(DEFAULT_ROOM_SETTINGS.gameMode).toBe("classic");
    expect(DEFAULT_ROOM_SETTINGS.maxAttempts).toBe(1);
    expect(DEFAULT_ROOM_SETTINGS.hintLimit).toBe(0);
  });

  it("preserves room mode and rounds while forcing single-attempt no-hint gameplay", () => {
    const merged = mergeRoomSettings({
      gameMode: "memory",
      maxAttempts: 3,
      hintLimit: 2,
      totalRounds: 5,
    });

    expect(merged.gameMode).toBe("memory");
    expect(merged.maxAttempts).toBe(1);
    expect(merged.hintLimit).toBe(0);
    expect(merged.totalRounds).toBe(5);
  });
});
