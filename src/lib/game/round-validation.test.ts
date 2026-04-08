import { beforeEach, describe, expect, it } from "vitest";

import {
  assertRoundOpen,
  assertRoundSubmissionWindow,
} from "@/lib/game/round-validation";
import { createRoomState, saveRoomState, __test__ as roomStateTest } from "@/lib/server/room-state";
import { dateAfterHours } from "@/lib/utils/time";

function createRoundState(promptStartsAt: Date, endsAt: Date) {
  const now = new Date("2026-04-07T10:00:00.000Z");
  const state = createRoomState({
    roomId: "ROOM1",
    code: "ROOM1",
    createdAt: now,
    expiresAt: dateAfterHours(24),
    createdByUid: "anon_1",
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
      totalRounds: 3,
      gameMode: "memory",
      cpuCount: 0,
    },
    ui: {
      theme: "neo-brutal",
    },
  });

  state.players.anon_1 = {
    uid: "anon_1",
    displayName: "Player",
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
    startedAt: now,
    promptStartsAt,
    endsAt,
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
    gmPrompt: "prompt",
    gmNegativePrompt: "",
    safety: {
      blocked: false,
    },
  };

  return state;
}

describe("assertRoundOpen", () => {
  beforeEach(() => {
    roomStateTest.resetMemoryStore();
  });

  it("rejects memory mode submissions before prompt entry starts", async () => {
    await saveRoomState(
      createRoundState(new Date(Date.now() + 10_000), new Date(Date.now() + 70_000)),
    );

    await expect(
      assertRoundOpen({
        roomId: "ROOM1",
        roundId: "round-1",
        uid: "anon_1",
      }),
    ).rejects.toMatchObject({
      code: "ROUND_CLOSED",
      message: "まだプロンプト入力開始前です。",
    });
  });

  it("allows submissions after prompt entry has started", async () => {
    await saveRoomState(
      createRoundState(new Date(Date.now() - 1_000), new Date(Date.now() + 60_000)),
    );

    const result = await assertRoundOpen({
      roomId: "ROOM1",
      roundId: "round-1",
      uid: "anon_1",
    });

    expect(result.round.roundId).toBe("round-1");
    expect(result.room.roomId).toBe("ROOM1");
  });

  it("uses the submission start time instead of current time", async () => {
    const startedAt = new Date(Date.now() - 5_000);
    const endsAt = new Date(Date.now() - 1_000);

    await saveRoomState(createRoundState(startedAt, endsAt));

    const result = await assertRoundOpen({
      roomId: "ROOM1",
      roundId: "round-1",
      uid: "anon_1",
      now: new Date(endsAt.getTime() - 2_000),
    });

    expect(result.round.roundId).toBe("round-1");
  });

  it("allows in-flight submissions to finish after the room has moved to results", () => {
    const referenceTime = new Date(Date.now() - 2_000);

    expect(() =>
      assertRoundSubmissionWindow({
        room: {
          status: "RESULTS",
          currentRoundId: "round-1",
        },
        round: {
          status: "RESULTS",
          promptStartsAt: new Date(referenceTime.getTime() - 10_000),
          endsAt: new Date(referenceTime.getTime() + 1_000),
        },
        roundId: "round-1",
        now: referenceTime,
        allowResults: true,
      }),
    ).not.toThrow();
  });
});
