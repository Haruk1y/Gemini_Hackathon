import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const roomGet = vi.fn();
const playerGet = vi.fn();
const playerUpdate = vi.fn();

vi.mock("@/lib/auth/verify-session", () => ({
  verifySessionCookie: vi.fn(() => ({ uid: "anon_1", issuedAt: Date.now() })),
}));

vi.mock("@/lib/api/paths", () => ({
  roomRef: vi.fn(() => ({
    get: roomGet,
  })),
  playerRef: vi.fn(() => ({
    get: playerGet,
    update: playerUpdate,
  })),
}));

function makeSnapshot<T>(data: T) {
  return {
    exists: true,
    data: () => data,
  };
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
    vi.resetModules();
    roomGet.mockReset();
    playerGet.mockReset();
    playerUpdate.mockReset();
  });

  it("toggles a ready player back to wait while in lobby", async () => {
    roomGet.mockResolvedValue(makeSnapshot({ status: "LOBBY" }));
    playerGet.mockResolvedValue(makeSnapshot({ ready: true }));

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
    expect(playerUpdate).toHaveBeenCalledWith({
      ready: false,
      lastSeenAt: expect.any(Date),
    });
  });

  it("returns a no-op when the player is already in the requested ready state", async () => {
    roomGet.mockResolvedValue(makeSnapshot({ status: "LOBBY" }));
    playerGet.mockResolvedValue(makeSnapshot({ ready: true }));

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
    expect(playerUpdate).not.toHaveBeenCalled();
  });

  it("rejects ready changes outside the lobby", async () => {
    roomGet.mockResolvedValue(makeSnapshot({ status: "IN_ROUND" }));
    playerGet.mockResolvedValue(makeSnapshot({ ready: true }));

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
    expect(playerUpdate).not.toHaveBeenCalled();
  });
});
