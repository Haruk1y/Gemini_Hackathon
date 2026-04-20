import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { verifySessionCookie } from "@/lib/auth/verify-session";
import { createRoomState, loadRoomState, saveRoomState, __test__ as roomStateTest } from "@/lib/server/room-state";
import { dateAfterHours } from "@/lib/utils/time";

const { mockAfter, mockEnsurePreparedRound } = vi.hoisted(() => ({
  mockAfter: vi.fn(),
  mockEnsurePreparedRound: vi.fn(),
}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after: mockAfter,
  };
});

vi.mock("@/lib/auth/verify-session", () => ({
  verifySessionCookie: vi.fn(() => ({
    uid: "host",
    session: { uid: "host", issuedAt: Date.now() },
  })),
}));

vi.mock("@/lib/game/round-service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/game/round-service")>(
    "@/lib/game/round-service",
  );
  return {
    ...actual,
    ensurePreparedRound: mockEnsurePreparedRound,
  };
});

function createResultsState() {
  const now = new Date("2026-04-08T10:00:00.000Z");
  const state = createRoomState({
    roomId: "ROOM1",
    code: "ROOM1",
    createdAt: now,
    expiresAt: dateAfterHours(24),
    createdByUid: "host",
    status: "RESULTS",
    currentRoundId: "round-1",
    roundIndex: 3,
    settings: {
      maxPlayers: 8,
      roundSeconds: 60,
      maxAttempts: 1,
      aspectRatio: "1:1",
      imageModel: "gemini",
      hintLimit: 0,
      totalRounds: 3,
      gameMode: "impostor",
      cpuCount: 1,
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
    totalScore: 10,
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
    totalScore: 8,
  };
  state.players["cpu-1"] = {
    uid: "cpu-1",
    displayName: "CPU 1",
    kind: "cpu",
    isHost: false,
    joinedAt: now,
    expiresAt: dateAfterHours(24),
    lastSeenAt: now,
    ready: true,
    totalScore: 6,
  };

  state.rounds["round-1"] = {
    roundId: "round-1",
    index: 3,
    status: "RESULTS",
    createdAt: now,
    expiresAt: dateAfterHours(24),
    startedAt: now,
    promptStartsAt: now,
    endsAt: now,
    targetImageUrl: "https://example.com/original.png",
    targetThumbUrl: "https://example.com/original.png",
    gmTitle: "Original",
    gmTags: [],
    difficulty: 3,
    reveal: {},
    stats: {
      submissions: 3,
      topScore: 88,
    },
    modeState: {
      kind: "impostor",
      phase: "REVEAL",
      turnOrder: ["host", "guest", "cpu-1"],
      currentTurnIndex: 3,
      currentTurnUid: null,
      chainImageUrl: "https://example.com/final.png",
      similarityThreshold: 70,
      finalSimilarityScore: 66,
      voteCount: 2,
      voteTarget: "guest",
      revealedTurns: 3,
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
        "cpu-1": "agent",
      },
      turnRecords: [],
      votesByUid: {
        host: "guest",
      },
      finalJudge: null,
      cpuVoteMeta: [],
    },
  };

  return state;
}

async function postBackToLobby(roomId: string) {
  const { POST } = await import("@/app/api/rooms/back-to-lobby/route");
  const request = new NextRequest("http://localhost/api/rooms/back-to-lobby", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "session=placeholder",
    },
    body: JSON.stringify({ roomId }),
  });

  return POST(request);
}

describe("POST /api/rooms/back-to-lobby", () => {
  beforeEach(() => {
    roomStateTest.resetMemoryStore();
    mockAfter.mockReset();
    mockEnsurePreparedRound.mockReset();
  });

  it("returns the whole room to lobby and resets replay state for the host", async () => {
    await saveRoomState(createResultsState());

    const response = await postBackToLobby("ROOM1");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      returned: true,
    });

    const state = await loadRoomState("ROOM1");
    expect(state?.room.status).toBe("LOBBY");
    expect(state?.room.currentRoundId).toBeNull();
    expect(state?.room.roundIndex).toBe(0);
    expect(state?.rounds).toEqual({});
    expect(state?.players.host?.ready).toBe(false);
    expect(state?.players.guest?.ready).toBe(false);
    expect(state?.players["cpu-1"]?.ready).toBe(true);
  });

  it("rejects non-host users", async () => {
    vi.mocked(verifySessionCookie).mockReturnValueOnce({
      uid: "guest",
      session: { uid: "guest", issuedAt: Date.now() },
    });

    await saveRoomState(createResultsState());
    const response = await postBackToLobby("ROOM1");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: {
        code: "NOT_HOST",
      },
    });
  });
});
