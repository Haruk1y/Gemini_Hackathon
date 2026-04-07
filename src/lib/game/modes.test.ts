import { describe, expect, it } from "vitest";

import { getRoundSchedule } from "@/lib/game/modes";

describe("game modes", () => {
  it("starts classic prompts immediately", () => {
    const startedAt = new Date("2026-04-07T10:00:00.000Z");
    const schedule = getRoundSchedule({
      gameMode: "classic",
      roundSeconds: 60,
      startedAt,
    });

    expect(schedule.promptStartsAt.toISOString()).toBe(startedAt.toISOString());
    expect(schedule.endsAt.getTime() - schedule.promptStartsAt.getTime()).toBe(60_000);
  });

  it("adds a 5-second preview before memory mode prompt entry", () => {
    const startedAt = new Date("2026-04-07T10:00:00.000Z");
    const schedule = getRoundSchedule({
      gameMode: "memory",
      roundSeconds: 60,
      startedAt,
    });

    expect(schedule.promptStartsAt.getTime() - startedAt.getTime()).toBe(5_000);
    expect(schedule.endsAt.getTime() - schedule.promptStartsAt.getTime()).toBe(60_000);
  });
});
