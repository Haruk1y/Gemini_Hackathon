import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  endRoundIfNeeded,
  submitChangeRoundClick,
} from "@/lib/game/round-service";
import {
  createRoomState,
  loadRoomState,
  saveRoomState,
  __test__ as roomStateTest,
} from "@/lib/server/room-state";
import { dateAfterHours, parseDate } from "@/lib/utils/time";

function createChangeRoundState() {
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
      roundSeconds: 30,
      maxAttempts: 1,
      aspectRatio: "1:1",
      imageModel: "gemini",
      promptModel: "flash",
      judgeModel: "flash",
      hintLimit: 0,
      totalRounds: 1,
      gameMode: "change",
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
    joinedAt: new Date(now.getTime() + 1_000),
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
    startedAt: now,
    promptStartsAt: now,
    endsAt: new Date(now.getTime() + 30_000),
    targetImageUrl: "https://example.com/target.png",
    targetThumbUrl: "https://example.com/target.png",
    gmTitle: "Kitchen Counter",
    gmTags: ["change"],
    difficulty: 2,
    reveal: {},
    stats: {
      submissions: 0,
      topScore: 0,
    },
    modeState: {
      kind: "change",
      baseImageUrl: "https://example.com/target.png",
      changedImageUrl: "https://example.com/changed.png",
      submittedCount: 0,
      correctCount: 0,
    },
  };

  state.roundPrivates["round-1"] = {
    roundId: "round-1",
    createdAt: now,
    expiresAt: dateAfterHours(24),
    gmPrompt: "kitchen prompt",
    gmNegativePrompt: "",
    safety: {
      blocked: false,
    },
    modeState: {
      answerBox: {
        x: 0.4,
        y: 0.35,
        width: 0.2,
        height: 0.2,
      },
      changeSummary: "yellow mug becomes blue bottle",
      submissionsByUid: {},
    },
  };

  return state;
}

describe("change round service", () => {
  beforeEach(() => {
    roomStateTest.resetMemoryStore();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T10:00:10.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("scores correct clicks by hit order and rejects repeat clicks", async () => {
    await saveRoomState(createChangeRoundState());

    await expect(
      submitChangeRoundClick({
        roomId: "ROOM1",
        roundId: "round-1",
        uid: "host",
        point: { x: 0.5, y: 0.4 },
      }),
    ).resolves.toEqual({
      hit: true,
      score: 100,
      rank: 1,
      submittedCount: 1,
      correctCount: 1,
    });

    await expect(
      submitChangeRoundClick({
        roomId: "ROOM1",
        roundId: "round-1",
        uid: "guest",
        point: { x: 0.45, y: 0.38 },
      }),
    ).resolves.toEqual({
      hit: true,
      score: 80,
      rank: 2,
      submittedCount: 2,
      correctCount: 2,
    });

    await expect(
      submitChangeRoundClick({
        roomId: "ROOM1",
        roundId: "round-1",
        uid: "host",
        point: { x: 0.52, y: 0.41 },
      }),
    ).rejects.toMatchObject({
      code: "ALREADY_GUESSED",
      status: 409,
    });

    const state = await loadRoomState("ROOM1");
    expect(state?.players.host.totalScore).toBe(100);
    expect(state?.players.guest.totalScore).toBe(80);
    expect(state?.rounds["round-1"]?.stats).toMatchObject({
      submissions: 2,
      topScore: 100,
    });
  });

  it("shortens to a grace window and then reveals the answer after all humans click", async () => {
    await saveRoomState(createChangeRoundState());

    await submitChangeRoundClick({
      roomId: "ROOM1",
      roundId: "round-1",
      uid: "host",
      point: { x: 0.5, y: 0.4 },
    });
    await submitChangeRoundClick({
      roomId: "ROOM1",
      roundId: "round-1",
      uid: "guest",
      point: { x: 0.1, y: 0.1 },
    });

    await expect(
      endRoundIfNeeded({
        roomId: "ROOM1",
        roundId: "round-1",
      }),
    ).resolves.toEqual({ status: "IN_ROUND" });

    let state = await loadRoomState("ROOM1");
    expect(state?.room.status).toBe("IN_ROUND");
    expect(parseDate(state?.rounds["round-1"]?.endsAt)?.toISOString()).toBe(
      "2026-04-07T10:00:20.000Z",
    );

    vi.setSystemTime(new Date("2026-04-07T10:00:21.000Z"));

    await expect(
      endRoundIfNeeded({
        roomId: "ROOM1",
        roundId: "round-1",
      }),
    ).resolves.toEqual({ status: "RESULTS" });

    state = await loadRoomState("ROOM1");
    expect(state?.room.status).toBe("RESULTS");
    expect(state?.rounds["round-1"]?.status).toBe("RESULTS");
    expect(state?.rounds["round-1"]?.reveal).toMatchObject({
      answerBox: {
        x: 0.4,
        y: 0.35,
        width: 0.2,
        height: 0.2,
      },
      changeSummary: "yellow mug becomes blue bottle",
    });
  });
});
