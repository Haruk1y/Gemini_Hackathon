import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { endRoundIfNeeded } from "@/lib/game/round-service";
import {
  createRoomState,
  loadRoomState,
  saveRoomState,
  __test__ as roomStateTest,
} from "@/lib/server/room-state";
import { dateAfterHours, parseDate } from "@/lib/utils/time";

function createClassicRoundState(params: {
  promptStartsAt: Date;
  endsAt: Date;
  attempts?: Record<string, unknown>;
  scores?: Record<string, unknown>;
}) {
  const now = new Date("2026-04-07T10:00:00.000Z");
  const state = createRoomState({
    roomId: "ROOM1",
    code: "ROOM1",
    createdAt: now,
    expiresAt: dateAfterHours(24),
    createdByUid: "host",
    status: "IN_ROUND",
    currentRoundId: "round-1",
    roundIndex: 1,
    settings: {
      maxPlayers: 8,
      roundSeconds: 60,
      maxAttempts: 1,
      aspectRatio: "1:1",
      imageModel: "flash",
      hintLimit: 0,
      totalRounds: 1,
      gameMode: "classic",
      cpuCount: 0,
    },
    ui: {
      theme: "neo-brutal",
    },
  });

  state.players.host = {
    uid: "host",
    displayName: "Host",
    kind: "human",
    isHost: true,
    joinedAt: now,
    expiresAt: dateAfterHours(24),
    lastSeenAt: now,
    ready: true,
    totalScore: 0,
  };
  state.players.guest = {
    uid: "guest",
    displayName: "Guest",
    kind: "human",
    isHost: false,
    joinedAt: now,
    expiresAt: dateAfterHours(24),
    lastSeenAt: now,
    ready: true,
    totalScore: 0,
  };

  state.rounds["round-1"] = {
    roundId: "round-1",
    index: 1,
    status: "IN_ROUND",
    createdAt: now,
    expiresAt: dateAfterHours(24),
    startedAt: params.promptStartsAt,
    promptStartsAt: params.promptStartsAt,
    endsAt: params.endsAt,
    targetImageUrl: "https://example.com/target.png",
    targetThumbUrl: "https://example.com/target.png",
    gmTitle: "Target",
    gmTags: [],
    difficulty: 3,
    reveal: {},
    stats: {
      submissions: 0,
      topScore: 0,
    },
  };

  state.roundPrivates["round-1"] = {
    roundId: "round-1",
    createdAt: now,
    expiresAt: dateAfterHours(24),
    gmPrompt: "gm prompt",
    gmNegativePrompt: "",
    safety: {
      blocked: false,
    },
  };

  if (params.attempts) {
    state.attempts["round-1"] = params.attempts as Record<string, never>;
  }

  if (params.scores) {
    state.scores["round-1"] = params.scores as Record<string, never>;
  }

  return state;
}

describe("endRoundIfNeeded classic/memory timing", () => {
  beforeEach(() => {
    roomStateTest.resetMemoryStore();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T10:01:10.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the round open while a started submission is still scoring", async () => {
    await saveRoomState(
      createClassicRoundState({
        promptStartsAt: new Date("2026-04-07T10:00:10.000Z"),
        endsAt: new Date("2026-04-07T10:01:09.000Z"),
        attempts: {
          host: {
            uid: "host",
            roundId: "round-1",
            expiresAt: dateAfterHours(24),
            attemptsUsed: 1,
            hintUsed: 0,
            bestScore: 0,
            bestAttemptNo: null,
            attempts: [
              {
                attemptNo: 1,
                prompt: "ongoing prompt",
                imageUrl: "",
                score: null,
                status: "SCORING",
                createdAt: new Date("2026-04-07T10:00:50.000Z"),
              },
            ],
            updatedAt: new Date("2026-04-07T10:00:50.000Z"),
          },
        },
      }),
    );

    await expect(
      endRoundIfNeeded({
        roomId: "ROOM1",
        roundId: "round-1",
      }),
    ).resolves.toEqual({ status: "IN_ROUND" });

    const state = await loadRoomState("ROOM1");
    expect(state?.room.status).toBe("IN_ROUND");
    expect(state?.rounds["round-1"]?.status).toBe("IN_ROUND");
    expect(parseDate(state?.rounds["round-1"]?.endsAt)?.toISOString()).toBe(
      "2026-04-07T10:01:09.000Z",
    );
  });

  it("schedules a 10-second grace window after the deadline when no scoring attempts remain", async () => {
    await saveRoomState(
      createClassicRoundState({
        promptStartsAt: new Date("2026-04-07T10:00:10.000Z"),
        endsAt: new Date("2026-04-07T10:01:10.000Z"),
      }),
    );

    await expect(
      endRoundIfNeeded({
        roomId: "ROOM1",
        roundId: "round-1",
      }),
    ).resolves.toEqual({ status: "IN_ROUND" });

    const state = await loadRoomState("ROOM1");
    expect(state?.room.status).toBe("IN_ROUND");
    expect(state?.rounds["round-1"]?.status).toBe("IN_ROUND");
    expect(parseDate(state?.rounds["round-1"]?.endsAt)?.toISOString()).toBe(
      "2026-04-07T10:01:20.000Z",
    );
  });

  it("moves to results after the post-deadline grace window expires", async () => {
    await saveRoomState(
      createClassicRoundState({
        promptStartsAt: new Date("2026-04-07T10:00:00.000Z"),
        endsAt: new Date("2026-04-07T10:01:09.000Z"),
      }),
    );

    await expect(
      endRoundIfNeeded({
        roomId: "ROOM1",
        roundId: "round-1",
      }),
    ).resolves.toEqual({ status: "RESULTS" });

    const state = await loadRoomState("ROOM1");
    expect(state?.room.status).toBe("RESULTS");
    expect(state?.rounds["round-1"]?.status).toBe("RESULTS");
    expect(state?.rounds["round-1"]?.reveal.gmPromptPublic).toBe("gm prompt");
  });

  it("still moves straight to results when an early-finish countdown expires", async () => {
    await saveRoomState(
      createClassicRoundState({
        promptStartsAt: new Date("2026-04-07T10:00:40.000Z"),
        endsAt: new Date("2026-04-07T10:01:09.000Z"),
        scores: {
          host: {
            uid: "host",
            displayName: "Host",
            bestScore: 90,
            bestImageUrl: "https://example.com/host.png",
            bestPromptPublic: "host prompt",
            updatedAt: new Date("2026-04-07T10:00:59.000Z"),
            expiresAt: dateAfterHours(24),
          },
          guest: {
            uid: "guest",
            displayName: "Guest",
            bestScore: 80,
            bestImageUrl: "https://example.com/guest.png",
            bestPromptPublic: "guest prompt",
            updatedAt: new Date("2026-04-07T10:00:59.000Z"),
            expiresAt: dateAfterHours(24),
          },
        },
      }),
    );

    await expect(
      endRoundIfNeeded({
        roomId: "ROOM1",
        roundId: "round-1",
      }),
    ).resolves.toEqual({ status: "RESULTS" });

    const state = await loadRoomState("ROOM1");
    expect(state?.room.status).toBe("RESULTS");
    expect(state?.rounds["round-1"]?.status).toBe("RESULTS");
  });
});
