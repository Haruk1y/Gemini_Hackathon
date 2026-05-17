import { describe, expect, it } from "vitest";

import {
  CHANGE_DEFAULT_ROUND_SECONDS,
  getGameModeDefinition,
  getGameModeOptions,
  getRoundSchedule,
  getRoundSubmissionDeadline,
  isPostDeadlineGraceActive,
  isRoundSecondsAllowedForMode,
  MEMORY_PREVIEW_SECONDS,
  normalizeRoundSecondsForMode,
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
    expect(schedule.endsAt.getTime() - schedule.promptStartsAt.getTime()).toBe(
      60_000,
    );
  });

  it("adds a fixed preview before memory mode prompt entry", () => {
    const startedAt = new Date("2026-04-07T10:00:00.000Z");
    const schedule = getRoundSchedule({
      gameMode: "memory",
      roundSeconds: 60,
      startedAt,
    });

    expect(schedule.promptStartsAt.getTime() - startedAt.getTime()).toBe(
      MEMORY_PREVIEW_SECONDS * 1000,
    );
    expect(schedule.endsAt.getTime() - schedule.promptStartsAt.getTime()).toBe(
      60_000,
    );
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

  it("keeps change mode prompts open immediately", () => {
    const startedAt = new Date("2026-04-07T10:00:00.000Z");
    const schedule = getRoundSchedule({
      gameMode: "change",
      roundSeconds: 30,
      startedAt,
    });

    expect(schedule.promptStartsAt.toISOString()).toBe(startedAt.toISOString());
    expect(schedule.endsAt.getTime() - schedule.promptStartsAt.getTime()).toBe(
      30_000,
    );
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
    expect(getGameModeDefinition("change", "ja").label).toBe("アハ体験");
    expect(getGameModeDefinition("change", "en").label).toBe("Aha Moment");
    expect(getGameModeDefinition("impostor", "ja").label).toBe(
      "ニセ画家を探せ",
    );
    expect(getGameModeDefinition("impostor", "en").shortLabel).toBe("Impostor");
  });

  it("includes Art Impostor in selectable game modes", () => {
    expect(getGameModeOptions("en").map((option) => option.mode)).toEqual([
      "classic",
      "memory",
      "change",
      "impostor",
    ]);
  });

  it("validates change-mode round durations separately", () => {
    expect(isRoundSecondsAllowedForMode("change", 15)).toBe(false);
    expect(isRoundSecondsAllowedForMode("change", 20)).toBe(false);
    expect(isRoundSecondsAllowedForMode("change", 30)).toBe(true);
    expect(isRoundSecondsAllowedForMode("change", 60)).toBe(false);
    expect(isRoundSecondsAllowedForMode("change", 65)).toBe(true);
    expect(isRoundSecondsAllowedForMode("change", 90)).toBe(false);
    expect(isRoundSecondsAllowedForMode("change", 100)).toBe(true);
    expect(isRoundSecondsAllowedForMode("change", 45)).toBe(false);
    expect(normalizeRoundSecondsForMode("change", 20)).toBe(
      CHANGE_DEFAULT_ROUND_SECONDS,
    );
    expect(normalizeRoundSecondsForMode("change", 45)).toBe(
      CHANGE_DEFAULT_ROUND_SECONDS,
    );
    expect(normalizeRoundSecondsForMode("change", 90)).toBe(
      CHANGE_DEFAULT_ROUND_SECONDS,
    );
    expect(normalizeRoundSecondsForMode("change", 100)).toBe(100);
    expect(normalizeRoundSecondsForMode("classic", 15)).toBe(15);
    expect(normalizeRoundSecondsForMode("classic", 75)).toBe(75);
    expect(normalizeRoundSecondsForMode("classic", 90)).toBe(90);
    expect(normalizeRoundSecondsForMode("classic", 120)).toBe(120);
  });
});
