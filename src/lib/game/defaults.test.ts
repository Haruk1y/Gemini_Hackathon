import { describe, expect, it } from "vitest";

import { DEFAULT_ROOM_SETTINGS, mergeRoomSettings } from "@/lib/game/defaults";

describe("game defaults", () => {
  it("defaults to a single attempt with no hints", () => {
    expect(DEFAULT_ROOM_SETTINGS.maxAttempts).toBe(1);
    expect(DEFAULT_ROOM_SETTINGS.hintLimit).toBe(0);
  });

  it("forces single-attempt no-hint gameplay even if other values are provided", () => {
    const merged = mergeRoomSettings({
      maxAttempts: 3,
      hintLimit: 2,
      totalRounds: 5,
    });

    expect(merged.maxAttempts).toBe(1);
    expect(merged.hintLimit).toBe(0);
    expect(merged.totalRounds).toBe(5);
  });
});
