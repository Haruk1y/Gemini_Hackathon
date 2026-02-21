import { describe, expect, it } from "vitest";

import { roomSettingsSchema } from "@/lib/api/schemas";

describe("api contracts", () => {
  it("validates default gameplay settings", () => {
    const parsed = roomSettingsSchema.parse({
      maxPlayers: 4,
      roundSeconds: 60,
      maxAttempts: 2,
      aspectRatio: "1:1",
      hintLimit: 1,
      totalRounds: 3,
    });

    expect(parsed.maxAttempts).toBe(2);
    expect(parsed.roundSeconds).toBe(60);
  });

  it("rejects invalid attempt settings", () => {
    expect(() =>
      roomSettingsSchema.parse({
        maxAttempts: 8,
      }),
    ).toThrow();
  });
});
