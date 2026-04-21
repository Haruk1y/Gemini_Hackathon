import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { verifySessionCookie } from "@/lib/auth/verify-session";
import { createRoomState, loadRoomState, saveRoomState, __test__ as roomStateTest } from "@/lib/server/room-state";
import { dateAfterHours } from "@/lib/utils/time";

vi.mock("@/lib/auth/verify-session", () => ({
  verifySessionCookie: vi.fn(() => ({
    uid: "host",
    session: { uid: "host", issuedAt: Date.now() },
  })),
}));

function createLobbyState() {
  const now = new Date("2026-04-08T10:00:00.000Z");
  const state = createRoomState({
    roomId: "ROOM1",
    code: "ROOM1",
    createdAt: now,
    expiresAt: dateAfterHours(24),
    createdByUid: "host",
    status: "LOBBY",
    currentRoundId: null,
    roundIndex: 0,
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
    seatOrder: 0,
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
    seatOrder: 1,
    isHost: false,
    joinedAt: now,
    expiresAt: dateAfterHours(24),
    lastSeenAt: now,
    ready: true,
    totalScore: 0,
  };
  state.players["cpu-1"] = {
    uid: "cpu-1",
    displayName: "CPU 1",
    kind: "cpu",
    seatOrder: 2,
    isHost: false,
    joinedAt: now,
    expiresAt: dateAfterHours(24),
    lastSeenAt: now,
    ready: true,
    totalScore: 0,
  };

  return state;
}

async function postShuffleOrder(roomId: string) {
  const { POST } = await import("@/app/api/rooms/shuffle-order/route");
  const request = new NextRequest("http://localhost/api/rooms/shuffle-order", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "session=placeholder",
    },
    body: JSON.stringify({ roomId }),
  });

  return POST(request);
}

describe("POST /api/rooms/shuffle-order", () => {
  beforeEach(() => {
    roomStateTest.resetMemoryStore();
  });

  it("shuffles seat order for the host while in lobby", async () => {
    const randomSpy = vi
      .spyOn(Math, "random")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0);
    await saveRoomState(createLobbyState());

    const response = await postShuffleOrder("ROOM1");

    randomSpy.mockRestore();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      order: ["guest", "cpu-1", "host"],
    });

    const state = await loadRoomState("ROOM1");
    expect(state?.players.guest?.seatOrder).toBe(0);
    expect(state?.players["cpu-1"]?.seatOrder).toBe(1);
    expect(state?.players.host?.seatOrder).toBe(2);
  });

  it("rejects non-host users", async () => {
    vi.mocked(verifySessionCookie).mockReturnValueOnce({
      uid: "guest",
      session: { uid: "guest", issuedAt: Date.now() },
    });

    await saveRoomState(createLobbyState());
    const response = await postShuffleOrder("ROOM1");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: {
        code: "NOT_HOST",
      },
    });
  });
});
