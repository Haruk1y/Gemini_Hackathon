import { describe, expect, it } from "vitest";

import {
  getGameModeDefinition,
  getRoundSchedule,
  getRoundSubmissionDeadline,
  isPostDeadlineGraceActive,
} from "@/lib/game/modes";

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

  it("adds a 10-second preview before memory mode prompt entry", () => {
    const startedAt = new Date("2026-04-07T10:00:00.000Z");
    const schedule = getRoundSchedule({
      gameMode: "memory",
      roundSeconds: 60,
      startedAt,
    });

    expect(schedule.promptStartsAt.getTime() - startedAt.getTime()).toBe(10_000);
    expect(schedule.endsAt.getTime() - schedule.promptStartsAt.getTime()).toBe(60_000);
  });

  it("derives the original submission deadline from prompt start time", () => {
    const promptStartsAt = new Date("2026-04-07T10:00:10.000Z");

    expect(
      getRoundSubmissionDeadline({
        promptStartsAt,
        roundSeconds: 60,
      })?.toISOString(),
    ).toBe("2026-04-07T10:01:10.000Z");
  });

  it("detects the post-deadline grace window after countdown expiry", () => {
    const promptStartsAt = new Date("2026-04-07T10:00:10.000Z");

    expect(
      isPostDeadlineGraceActive({
        promptStartsAt,
        roundSeconds: 60,
        endsAt: new Date("2026-04-07T10:01:25.000Z"),
        now: new Date("2026-04-07T10:01:20.000Z"),
      }),
    ).toBe(true);

    expect(
      isPostDeadlineGraceActive({
        promptStartsAt,
        roundSeconds: 60,
        endsAt: new Date("2026-04-07T10:00:50.000Z"),
        now: new Date("2026-04-07T10:00:45.000Z"),
      }),
    ).toBe(false);
  });

  it("returns localized game mode copy", () => {
    expect(getGameModeDefinition("memory", "ja").label).toBe("記憶勝負");
    expect(getGameModeDefinition("memory", "en").label).toBe("Memory Match");
    expect(getGameModeDefinition("impostor", "en").shortLabel).toBe("Impostor");
  });
});
