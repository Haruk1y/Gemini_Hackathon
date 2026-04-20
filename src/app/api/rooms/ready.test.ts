import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createRoomState, saveRoomState, __test__ as roomStateTest } from "@/lib/server/room-state";
import { dateAfterHours } from "@/lib/utils/time";

vi.mock("@/lib/auth/verify-session", () => ({
  verifySessionCookie: vi.fn(() => ({ uid: "anon_1", issuedAt: Date.now() })),
}));

function createLobbyState() {
  const now = new Date("2026-04-07T10:00:00.000Z");
  const state = createRoomState({
    roomId: "ROOM1",
    code: "ROOM1",
    createdAt: now,
    expiresAt: dateAfterHours(24),
    createdByUid: "anon_1",
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
      gameMode: "classic",
      cpuCount: 0,
    },
    ui: {
      theme: "neo-brutal",
    },
  });

  state.players.anon_1 = {
    uid: "anon_1",
    displayName: "Alice",
    kind: "human",
    isHost: true,
    joinedAt: now,
    expiresAt: dateAfterHours(24),
    lastSeenAt: now,
    ready: true,
    totalScore: 0,
  };

  return state;
}

async function postReady(body: { roomId: string; ready: boolean }) {
  const { POST } = await import("@/app/api/rooms/ready/route");
  const request = new NextRequest("http://localhost/api/rooms/ready", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "session=placeholder",
    },
    body: JSON.stringify(body),
  });

  return POST(request);
}

describe("POST /api/rooms/ready", () => {
  beforeEach(() => {
    roomStateTest.resetMemoryStore();
  });

  it("toggles a ready player back to wait while in lobby", async () => {
    await saveRoomState(createLobbyState());

    const response = await postReady({
      roomId: "ROOM1",
      ready: false,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      updated: true,
      ready: false,
    });
  });

  it("returns a no-op when the player is already in the requested ready state", async () => {
    await saveRoomState(createLobbyState());

    const response = await postReady({
      roomId: "ROOM1",
      ready: true,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      updated: false,
      ready: true,
    });
  });

  it("rejects ready changes outside the lobby", async () => {
    const state = createLobbyState();
    state.room.status = "IN_ROUND";
    await saveRoomState(state);

    const response = await postReady({
      roomId: "ROOM1",
      ready: false,
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
      },
    });
  });
});
