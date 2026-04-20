import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockReserveClassicRoundAttemptInState,
  mockSubmitClassicRoundAttemptWithReservation,
} = vi.hoisted(() => ({
  mockReserveClassicRoundAttemptInState: vi.fn(),
  mockSubmitClassicRoundAttemptWithReservation: vi.fn(),
}));

vi.mock("@/lib/game/classic-submit", () => ({
  reserveClassicRoundAttemptInState: mockReserveClassicRoundAttemptInState,
  submitClassicRoundAttemptWithReservation:
    mockSubmitClassicRoundAttemptWithReservation,
}));

import { endRoundIfNeeded } from "@/lib/game/round-service";
import {
  createRoomState,
  loadRoomState,
  saveRoomState,
  __test__ as roomStateTest,
} from "@/lib/server/room-state";
import { dateAfterHours } from "@/lib/utils/time";

function createClassicRoundState() {
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
      imageModel: "gemini",
      promptModel: "flash",
      judgeModel: "flash",
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
    startedAt: new Date("2026-04-07T10:00:10.000Z"),
    promptStartsAt: new Date("2026-04-07T10:00:10.000Z"),
    endsAt: new Date("2026-04-07T10:01:10.000Z"),
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

  return state;
}

describe("endRoundIfNeeded timeout draft auto-submit", () => {
  beforeEach(() => {
    roomStateTest.resetMemoryStore();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T10:01:10.000Z"));
    mockReserveClassicRoundAttemptInState.mockReset();
    mockSubmitClassicRoundAttemptWithReservation.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("consumes a timed-out classic draft before moving toward results", async () => {
    mockReserveClassicRoundAttemptInState.mockImplementation(
      ({ state, roundId, uid, prompt }) => {
        const createdAt = new Date("2026-04-07T10:01:10.000Z");
        state.attempts[roundId] = {
          [uid]: {
            uid,
            roundId,
            expiresAt: dateAfterHours(24),
            attemptsUsed: 1,
            hintUsed: 0,
            bestScore: 0,
            bestAttemptNo: null,
            attempts: [
              {
                attemptNo: 1,
                prompt,
                imageUrl: "",
                score: null,
                status: "SCORING",
                createdAt,
              },
            ],
            updatedAt: createdAt,
          },
        };

        return {
          attemptNo: 1,
          createdAt,
          aspectRatio: "1:1" as const,
          targetImageUrl: "https://example.com/target.png",
        };
      },
    );
    mockSubmitClassicRoundAttemptWithReservation.mockResolvedValue({
      attemptNo: 1,
      score: 88,
      imageUrl: "https://example.com/generated.png",
      bestScore: 88,
      matchedElements: ["subject"],
      missingElements: [],
      judgeNote: "close match",
    });

    await saveRoomState(createClassicRoundState());

    await expect(
      endRoundIfNeeded({
        roomId: "ROOM1",
        roundId: "round-1",
        uid: "host",
        draftPrompt: "partial timeout draft",
      }),
    ).resolves.toEqual({
      status: "IN_ROUND",
      consumedDraft: true,
    });

    expect(mockReserveClassicRoundAttemptInState).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: "ROOM1",
        roundId: "round-1",
        uid: "host",
        prompt: "partial timeout draft",
        mode: "timeout",
      }),
    );
    expect(mockSubmitClassicRoundAttemptWithReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: "ROOM1",
        roundId: "round-1",
        uid: "host",
        prompt: "partial timeout draft",
        mode: "timeout",
      }),
    );

    const state = await loadRoomState("ROOM1");
    expect(
      state?.attempts["round-1"]?.host?.attempts[0],
    ).toMatchObject({
      prompt: "partial timeout draft",
      status: "SCORING",
    });
  });
});
