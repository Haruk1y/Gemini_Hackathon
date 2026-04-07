import { beforeEach, describe, expect, it, vi } from "vitest";

const roomRef = vi.fn();
const roundRef = vi.fn();
const playerRef = vi.fn();
const roundPrivateRef = vi.fn();

vi.mock("@/lib/api/paths", () => ({
  roomRef,
  roundRef,
  playerRef,
  roundPrivateRef,
}));

function doc<T>(value: T) {
  return {
    exists: true,
    data: () => value,
  };
}

const roomDoc = {
  roomId: "ROOM1",
  code: "ROOM1",
  status: "IN_ROUND" as const,
  currentRoundId: "round-1",
  roundIndex: 1,
  settings: {
    maxPlayers: 8,
    roundSeconds: 60,
    maxAttempts: 1,
    aspectRatio: "1:1" as const,
    imageModel: "flash" as const,
    hintLimit: 0,
    totalRounds: 3,
    gameMode: "memory" as const,
  },
};

const playerDoc = {
  uid: "anon_1",
  displayName: "Player",
  isHost: false,
  joinedAt: new Date("2026-04-07T10:00:00.000Z"),
  expiresAt: new Date("2026-04-08T10:00:00.000Z"),
  lastSeenAt: new Date("2026-04-07T10:00:00.000Z"),
  ready: true,
  totalScore: 0,
};

const roundPrivateDoc = {
  targetCaptionText: "caption",
  gmPrompt: "prompt",
};

describe("assertRoundOpen", () => {
  beforeEach(() => {
    vi.resetModules();
    roomRef.mockReset();
    roundRef.mockReset();
    playerRef.mockReset();
    roundPrivateRef.mockReset();
  });

  it("rejects memory mode submissions before prompt entry starts", async () => {
    roomRef.mockReturnValue({
      get: vi.fn().mockResolvedValue(doc(roomDoc)),
    });
    roundRef.mockReturnValue({
      get: vi.fn().mockResolvedValue(
        doc({
          roundId: "round-1",
          index: 1,
          status: "IN_ROUND" as const,
          promptStartsAt: new Date(Date.now() + 10_000),
          endsAt: new Date(Date.now() + 70_000),
        }),
      ),
    });
    playerRef.mockReturnValue({
      get: vi.fn().mockResolvedValue(doc(playerDoc)),
    });
    roundPrivateRef.mockReturnValue({
      get: vi.fn().mockResolvedValue(doc(roundPrivateDoc)),
    });

    const { assertRoundOpen } = await import("@/lib/game/round-validation");

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
    roomRef.mockReturnValue({
      get: vi.fn().mockResolvedValue(doc(roomDoc)),
    });
    roundRef.mockReturnValue({
      get: vi.fn().mockResolvedValue(
        doc({
          roundId: "round-1",
          index: 1,
          status: "IN_ROUND" as const,
          promptStartsAt: new Date(Date.now() - 1_000),
          endsAt: new Date(Date.now() + 60_000),
        }),
      ),
    });
    playerRef.mockReturnValue({
      get: vi.fn().mockResolvedValue(doc(playerDoc)),
    });
    roundPrivateRef.mockReturnValue({
      get: vi.fn().mockResolvedValue(doc(roundPrivateDoc)),
    });

    const { assertRoundOpen } = await import("@/lib/game/round-validation");
    const result = await assertRoundOpen({
      roomId: "ROOM1",
      roundId: "round-1",
      uid: "anon_1",
    });

    expect(result.round.roundId).toBe("round-1");
  });
});
