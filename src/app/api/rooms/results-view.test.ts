import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { verifySessionCookie } from "@/lib/auth/verify-session";
import {
  createRoomState,
  loadRoomState,
  saveRoomState,
  __test__ as roomStateTest,
} from "@/lib/server/room-state";
import { dateAfterHours } from "@/lib/utils/time";

vi.mock("@/lib/auth/verify-session", () => ({
  verifySessionCookie: vi.fn(() => ({
    uid: "host",
    session: { uid: "host", issuedAt: Date.now() },
  })),
}));

function createResultsState() {
  const now = new Date("2026-04-22T10:00:00.000Z");
  const state = createRoomState({
    roomId: "ROOM1",
    code: "ROOM1",
    createdAt: now,
    expiresAt: dateAfterHours(24),
    createdByUid: "host",
    status: "RESULTS",
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
      totalRounds: 3,
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
    totalScore: 91,
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
    totalScore: 88,
  };
  state.rounds["round-1"] = {
    roundId: "round-1",
    index: 1,
    status: "RESULTS",
    createdAt: now,
    expiresAt: dateAfterHours(24),
    startedAt: now,
    promptStartsAt: now,
    endsAt: now,
    targetImageUrl: "https://example.com/target.png",
    targetThumbUrl: "https://example.com/target.png",
    gmTitle: "Target",
    gmTags: [],
    difficulty: 3,
    reveal: {},
    stats: {
      submissions: 2,
      topScore: 91,
    },
  };

  return state;
}

async function postResultsView(body: {
  roomId: string;
  roundId: string;
  showTotalRanking: boolean;
}) {
  const { POST } = await import("@/app/api/rooms/results-view/route");
  const request = new NextRequest("http://localhost/api/rooms/results-view", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "session=placeholder",
    },
    body: JSON.stringify(body),
  });

  return POST(request);
}

describe("POST /api/rooms/results-view", () => {
  beforeEach(() => {
    roomStateTest.resetMemoryStore();
    vi.mocked(verifySessionCookie).mockReset();
    vi.mocked(verifySessionCookie).mockReturnValue({
      uid: "host",
      session: { uid: "host", issuedAt: Date.now() },
    });
  });

  it("lets the host reveal total ranking for the active results round", async () => {
    await saveRoomState(createResultsState());

    const response = await postResultsView({
      roomId: "ROOM1",
      roundId: "round-1",
      showTotalRanking: true,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      resultsView: {
        roundId: "round-1",
        showTotalRanking: true,
      },
    });

    const state = await loadRoomState("ROOM1");
    expect(state?.room.ui.resultsView).toEqual({
      roundId: "round-1",
      showTotalRanking: true,
    });
  });

  it("rejects non-host users", async () => {
    vi.mocked(verifySessionCookie).mockReturnValueOnce({
      uid: "guest",
      session: { uid: "guest", issuedAt: Date.now() },
    });
    await saveRoomState(createResultsState());

    const response = await postResultsView({
      roomId: "ROOM1",
      roundId: "round-1",
      showTotalRanking: true,
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: {
        code: "NOT_HOST",
      },
    });
  });
});
