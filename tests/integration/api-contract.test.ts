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
      gameMode: "classic",
      cpuCount: 0,
    });

    expect(parsed.maxAttempts).toBe(1);
    expect(parsed.hintLimit).toBe(0);
    expect(parsed.roundSeconds).toBe(60);
    expect(parsed.totalRounds).toBe(1);
    expect(parsed.gameMode).toBe("classic");
  });

  it("accepts supported game modes", () => {
    expect(
      roomSettingsSchema.parse({
        gameMode: "classic",
      }).gameMode,
    ).toBe("classic");

    expect(
      roomSettingsSchema.parse({
        gameMode: "memory",
      }).gameMode,
    ).toBe("memory");

    expect(
      roomSettingsSchema.parse({
        gameMode: "impostor",
      }).gameMode,
    ).toBe("impostor");
  });

  it("accepts cpuCount within the supported range", () => {
    expect(
      roomSettingsSchema.parse({
        cpuCount: 2,
      }).cpuCount,
    ).toBe(2);
  });

  it("accepts minimum and maximum totalRounds values", () => {
    expect(
      roomSettingsSchema.parse({
        totalRounds: 1,
      }).totalRounds,
    ).toBe(1);

    expect(
      roomSettingsSchema.parse({
        totalRounds: 3,
      }).totalRounds,
    ).toBe(3);
  });

  it("accepts supported roundSeconds values", () => {
    expect(
      roomSettingsSchema.parse({
        roundSeconds: 30,
      }).roundSeconds,
    ).toBe(30);

    expect(
      roomSettingsSchema.parse({
        roundSeconds: 60,
      }).roundSeconds,
    ).toBe(60);
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

  it("rejects roundSeconds outside the supported range", () => {
    expect(() =>
      roomSettingsSchema.parse({
        roundSeconds: 29,
      }),
    ).toThrow();

    expect(() =>
      roomSettingsSchema.parse({
        roundSeconds: 61,
      }),
    ).toThrow();
  });

  it("rejects unsupported game modes", () => {
    expect(() =>
      roomSettingsSchema.parse({
        gameMode: "speedrun",
      }),
    ).toThrow();
  });

  it("rejects cpuCount outside the supported range", () => {
    expect(() =>
      roomSettingsSchema.parse({
        cpuCount: -1,
      }),
    ).toThrow();

    expect(() =>
      roomSettingsSchema.parse({
        cpuCount: 7,
      }),
    ).toThrow();
  });
});
