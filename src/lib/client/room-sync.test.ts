import { describe, expect, it } from "vitest";

import { normalizeSnapshot } from "@/lib/client/room-sync";

describe("normalizeSnapshot", () => {
  it("accepts results payloads that expose myAttempts", () => {
    const snapshot = normalizeSnapshot({
      room: {
        status: "RESULTS",
        currentRoundId: "round-1",
      },
      myAttempts: {
        attemptsUsed: 1,
        bestScore: 88,
        attempts: [
          {
            attemptNo: 1,
            imageUrl: "https://example.com/a.png",
            score: 88,
            prompt: "prompt",
            status: "DONE",
          },
        ],
      },
      players: [
        {
          uid: "anon_1",
          displayName: "Alice",
          ready: true,
          isHost: true,
          totalScore: 88,
        },
      ],
    });

    expect(snapshot.room?.status).toBe("RESULTS");
    expect(snapshot.attempts?.bestScore).toBe(88);
    expect(snapshot.players[0]?.uid).toBe("anon_1");
  });

  it("preserves GENERATING attempts in room snapshots", () => {
    const snapshot = normalizeSnapshot({
      room: {
        status: "IN_ROUND",
        currentRoundId: "round-1",
      },
      myAttempts: {
        attemptsUsed: 1,
        bestScore: 0,
        attempts: [
          {
            attemptNo: 1,
            imageUrl: "",
            score: null,
            prompt: "ねこ",
            status: "GENERATING",
          },
        ],
      },
      players: [
        {
          uid: "anon_1",
          displayName: "Alice",
          ready: true,
          isHost: true,
          totalScore: 0,
        },
      ],
    });

    expect(snapshot.attempts?.attempts[0]?.status).toBe("GENERATING");
  });

  it("normalizes score totals while preserving legacy score payloads", () => {
    const snapshot = normalizeSnapshot({
      scores: [
        {
          uid: "anon_1",
          displayName: "Alice",
          bestScore: 42,
          totalScore: 120,
          bestImageUrl: "https://example.com/alice.png",
        },
        {
          uid: "anon_2",
          displayName: "Bob",
          bestScore: 35,
          bestImageUrl: "https://example.com/bob.png",
        },
      ],
    });

    expect(snapshot.scores[0]).toMatchObject({
      uid: "anon_1",
      bestScore: 42,
      totalScore: 120,
    });
    expect(snapshot.scores[1]).toMatchObject({
      uid: "anon_2",
      bestScore: 35,
      totalScore: 35,
    });
  });

  it("keeps transition payloads usable when only current player is provided", () => {
    const snapshot = normalizeSnapshot({
      room: {
        status: "RESULTS",
        currentRoundId: null,
      },
      players: [
        {
          uid: "anon_2",
          displayName: "Bob",
          ready: false,
          isHost: false,
          totalScore: 12,
        },
      ],
    });

    expect(snapshot.players).toHaveLength(1);
    expect(snapshot.players[0]?.isHost).toBe(false);
  });

  it("normalizes shared results view state", () => {
    const snapshot = normalizeSnapshot({
      room: {
        status: "RESULTS",
        currentRoundId: "round-1",
        ui: {
          resultsView: {
            roundId: "round-1",
            showTotalRanking: true,
          },
        },
      },
    });

    expect(snapshot.room?.ui?.resultsView).toEqual({
      roundId: "round-1",
      showTotalRanking: true,
    });
  });
});
