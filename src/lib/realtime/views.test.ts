import { describe, expect, it } from "vitest";

import { createRoomState } from "@/lib/server/room-state";
import { buildRoomViewSnapshot, serializeForClient, shouldConcealRoundTarget } from "@/lib/realtime/views";
import { dateAfterHours } from "@/lib/utils/time";

describe("serializeForClient", () => {
  it("keeps plain strings unchanged", () => {
    expect(serializeForClient("2001")).toBe("2001");
    expect(serializeForClient("2001-01-01T00:00:00.000Z")).toBe("2001-01-01T00:00:00.000Z");
  });

  it("serializes nested date values without rewriting display names", () => {
    const serialized = serializeForClient({
      displayName: "2001",
      totalScore: 1,
      joinedAt: new Date("2026-04-03T02:30:00.000Z"),
      nested: {
        roundIndex: 2,
        lastSeenAt: {
          seconds: "1775183400",
          nanoseconds: "500000000",
        },
      },
    });

    expect(serialized).toEqual({
      displayName: "2001",
      totalScore: 1,
      joinedAt: "2026-04-03T02:30:00.000Z",
      nested: {
        roundIndex: 2,
        lastSeenAt: "2026-04-03T02:30:00.500Z",
      },
    });
  });
});

describe("shouldConcealRoundTarget", () => {
  it("conceals the memory target after preview when the player has no generated image yet", () => {
    expect(
      shouldConcealRoundTarget({
        gameMode: "memory",
        roundStatus: "IN_ROUND",
        promptStartsAt: new Date(Date.now() - 1_000),
      }),
    ).toBe(true);
  });

  it("reveals the memory target once the player has a generated image", () => {
    expect(
      shouldConcealRoundTarget({
        gameMode: "memory",
        roundStatus: "IN_ROUND",
        promptStartsAt: new Date(Date.now() - 1_000),
        attemptData: {
          attempts: [{ imageUrl: "https://example.com/attempt.png" }],
        },
      }),
    ).toBe(false);
  });
});

function createImpostorState() {
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
      totalRounds: 3,
      gameMode: "impostor",
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
    startedAt: now,
    promptStartsAt: now,
    endsAt: new Date(now.getTime() + 60_000),
    targetImageUrl: "https://example.com/original.png",
    targetThumbUrl: "https://example.com/original.png",
    gmTitle: "Original",
    gmTags: [],
    difficulty: 3,
    reveal: {},
    stats: {
      submissions: 1,
      topScore: 62,
    },
    modeState: {
      kind: "impostor",
      phase: "CHAIN",
      turnOrder: ["host", "guest"],
      currentTurnIndex: 0,
      currentTurnUid: "host",
      chainImageUrl: "https://example.com/chain.png",
      similarityThreshold: 70,
      finalSimilarityScore: null,
      voteCount: 0,
      voteTarget: null,
      revealedTurns: 0,
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
    modeState: {
      rolesByUid: {
        host: "agent",
        guest: "impostor",
      },
      turnRecords: [
        {
          uid: "host",
          displayName: "Host",
          kind: "human",
          role: "agent",
          prompt: "first prompt",
          imageUrl: "https://example.com/turn-1.png",
          referenceImageUrl: "https://example.com/original.png",
          similarityScore: 62,
          matchedElements: ["subject"],
          missingElements: ["background"],
          judgeNote: "close enough",
          createdAt: now,
        },
      ],
      votesByUid: {
        host: "guest",
      },
      finalJudge: {
        score: 66,
        matchedElements: ["subject"],
        missingElements: ["lighting"],
        note: "final judge",
      },
      cpuVoteMeta: [],
    },
  };

  return state;
}

describe("buildRoomViewSnapshot impostor mode", () => {
  it("hides chain images from waiting players during the chain", () => {
    const snapshot = buildRoomViewSnapshot({
      state: createImpostorState(),
      uid: "guest",
      view: "round",
    }) as unknown as {
      isMyTurn: boolean;
      myRole: string | null;
      turnTimeline: Array<{
        uid: string;
        imageUrl: string;
      }>;
      round: {
        targetImageUrl: string;
        modeState: {
          chainImageUrl: string;
        };
      };
    };

    expect(snapshot.isMyTurn).toBe(false);
    expect(snapshot.myRole).toBe("impostor");
    expect(snapshot.round.targetImageUrl).toBe("");
    expect(snapshot.round.modeState.chainImageUrl).toBe("");
    expect(snapshot.turnTimeline).toEqual([]);
  });

  it("shows only the current reference image to the active player", () => {
    const snapshot = buildRoomViewSnapshot({
      state: createImpostorState(),
      uid: "host",
      view: "round",
    }) as unknown as {
      isMyTurn: boolean;
      round: {
        targetImageUrl: string;
        modeState: {
          chainImageUrl: string;
        };
      };
      turnTimeline: unknown[];
    };

    expect(snapshot.isMyTurn).toBe(true);
    expect(snapshot.round.targetImageUrl).toBe("https://example.com/original.png");
    expect(snapshot.round.modeState.chainImageUrl).toBe("https://example.com/chain.png");
    expect(snapshot.turnTimeline).toEqual([]);
  });

  it("keeps prompts and roles hidden until reveal, then exposes them", () => {
    const state = createImpostorState();
    state.room.status = "RESULTS";
    state.rounds["round-1"]!.status = "RESULTS";
    state.rounds["round-1"]!.modeState = {
      ...state.rounds["round-1"]!.modeState!,
      phase: "VOTING",
      finalSimilarityScore: 66,
    };

    const votingSnapshot = buildRoomViewSnapshot({
      state,
      uid: "host",
      view: "results",
    }) as unknown as {
      revealLocked: boolean;
      turnTimeline: Array<{
        prompt?: string;
        role?: string;
      }>;
    };

    expect(votingSnapshot.revealLocked).toBe(true);
    expect(votingSnapshot.turnTimeline[0].prompt).toBeUndefined();
    expect(votingSnapshot.turnTimeline[0].role).toBeUndefined();

    state.rounds["round-1"]!.modeState = {
      ...state.rounds["round-1"]!.modeState!,
      phase: "REVEAL",
      voteTarget: "guest",
      voteCount: 1,
      revealedTurns: 1,
    };

    const revealSnapshot = buildRoomViewSnapshot({
      state,
      uid: "host",
      view: "results",
    }) as unknown as {
      revealLocked: boolean;
      turnTimeline: Array<{
        prompt?: string;
        role?: string;
      }>;
    };

    expect(revealSnapshot.revealLocked).toBe(false);
    expect(revealSnapshot.turnTimeline[0].prompt).toBe("first prompt");
    expect(revealSnapshot.turnTimeline[0].role).toBe("agent");
  });

  it("orders result timeline by turnOrder even if turnRecords were stored in a different order", () => {
    const state = createImpostorState();
    const now = new Date("2026-04-08T10:00:00.000Z");
    state.room.status = "RESULTS";
    state.rounds["round-1"]!.status = "RESULTS";
    state.rounds["round-1"]!.modeState = {
      ...state.rounds["round-1"]!.modeState!,
      phase: "REVEAL",
      turnOrder: ["guest", "host"],
      voteTarget: "guest",
      voteCount: 1,
      revealedTurns: 2,
    };
    state.roundPrivates["round-1"]!.modeState = {
      ...state.roundPrivates["round-1"]!.modeState!,
      turnRecords: [
        {
          uid: "host",
          displayName: "Host",
          kind: "human",
          role: "agent",
          prompt: "first prompt",
          imageUrl: "https://example.com/turn-1.png",
          referenceImageUrl: "https://example.com/original.png",
          similarityScore: 62,
          matchedElements: ["subject"],
          missingElements: ["background"],
          judgeNote: "close enough",
          createdAt: now,
        },
        {
          uid: "guest",
          displayName: "Guest",
          kind: "human",
          role: "impostor",
          prompt: "guest prompt",
          imageUrl: "https://example.com/turn-2.png",
          referenceImageUrl: "https://example.com/turn-1.png",
          similarityScore: 41,
          matchedElements: ["subject"],
          missingElements: ["lighting"],
          judgeNote: "drifted",
          createdAt: now,
        },
      ],
    };

    const snapshot = buildRoomViewSnapshot({
      state,
      uid: "host",
      view: "results",
    }) as unknown as {
      turnTimeline: Array<{
        uid: string;
        imageUrl: string;
      }>;
    };

    expect(snapshot.turnTimeline.map((entry) => entry.uid)).toEqual(["guest", "host"]);
    expect(snapshot.turnTimeline[0].imageUrl).toBe("https://example.com/turn-2.png");
    expect(snapshot.turnTimeline[1].imageUrl).toBe("https://example.com/turn-1.png");
  });
});
