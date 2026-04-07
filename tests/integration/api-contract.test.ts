import { describe, expect, it } from "vitest";

import { roomSettingsSchema } from "@/lib/api/schemas";

describe("api contracts", () => {
  it("validates default gameplay settings", () => {
    const parsed = roomSettingsSchema.parse({
      maxPlayers: 4,
      roundSeconds: 60,
      maxAttempts: 1,
      aspectRatio: "1:1",
      hintLimit: 0,
      totalRounds: 3,
    });

    expect(parsed.maxAttempts).toBe(1);
    expect(parsed.hintLimit).toBe(0);
    expect(parsed.roundSeconds).toBe(60);
  });

  it("accepts minimum and maximum totalRounds values", () => {
    expect(
      roomSettingsSchema.parse({
        totalRounds: 1,
      }).totalRounds,
    ).toBe(1);

    expect(
      roomSettingsSchema.parse({
        totalRounds: 5,
      }).totalRounds,
    ).toBe(5);
  });

  it("rejects invalid attempt settings", () => {
    expect(() =>
      roomSettingsSchema.parse({
        maxAttempts: 2,
      }),
    ).toThrow();
  });

  it("rejects any positive hint limit because hints are disabled", () => {
    expect(() =>
      roomSettingsSchema.parse({
        hintLimit: 1,
      }),
    ).toThrow();
  });

  it("rejects totalRounds outside the supported range", () => {
    expect(() =>
      roomSettingsSchema.parse({
        totalRounds: 0,
      }),
    ).toThrow();

    expect(() =>
      roomSettingsSchema.parse({
        totalRounds: 6,
      }),
    ).toThrow();
  });
});
