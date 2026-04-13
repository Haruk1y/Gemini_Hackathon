import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockVerifySessionCookie,
  mockBuildRoomViewSnapshot,
  mockLoadRoomState,
  mockGetRoomStateBackendInfo,
  mockEndRoundIfNeeded,
} = vi.hoisted(() => ({
  mockVerifySessionCookie: vi.fn(),
  mockBuildRoomViewSnapshot: vi.fn(),
  mockLoadRoomState: vi.fn(),
  mockGetRoomStateBackendInfo: vi.fn(),
  mockEndRoundIfNeeded: vi.fn(),
}));

vi.mock("@/lib/auth/verify-session", () => ({
  verifySessionCookie: mockVerifySessionCookie,
}));

vi.mock("@/lib/realtime/views", () => ({
  buildRoomViewSnapshot: mockBuildRoomViewSnapshot,
}));

vi.mock("@/lib/server/room-state", () => ({
  getRoomStateBackendInfo: mockGetRoomStateBackendInfo,
  loadRoomState: mockLoadRoomState,
}));

vi.mock("@/lib/game/round-service", () => ({
  endRoundIfNeeded: mockEndRoundIfNeeded,
}));

function createState(params: {
  version: number;
  status: "IN_ROUND" | "RESULTS";
  endsAt: string;
}) {
  return {
    version: params.version,
    room: {
      roomId: "ROOM1",
      code: "ROOM1",
      status: params.status,
      currentRoundId: "round-1",
      settings: {
        gameMode: "impostor",
      },
    },
    rounds: {
      "round-1": {
        roundId: "round-1",
        status: params.status,
        endsAt: params.endsAt,
      },
    },
    roundPrivates: {},
    players: {
      host: {
        uid: "host",
      },
    },
    attempts: {},
    scores: {},
  };
}

describe("GET /api/rooms/[roomId]/snapshot timeout handling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    mockVerifySessionCookie.mockReset();
    mockBuildRoomViewSnapshot.mockReset();
    mockLoadRoomState.mockReset();
    mockGetRoomStateBackendInfo.mockReset();
    mockEndRoundIfNeeded.mockReset();

    mockVerifySessionCookie.mockReturnValue({ uid: "host", issuedAt: Date.now() });
    mockGetRoomStateBackendInfo.mockReturnValue({
      kind: "memory",
      envSource: null,
    });
    mockBuildRoomViewSnapshot.mockImplementation(({ state }) => ({
      room: {
        status: state.room.status,
      },
      players: [],
      round: null,
      scores: [],
      attempts: null,
      playerCount: 0,
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("advances an expired round while serving round snapshots", async () => {
    const expiredState = createState({
      version: 1,
      status: "IN_ROUND",
      endsAt: "2026-04-13T14:00:00.000Z",
    });
    const updatedState = createState({
      version: 2,
      status: "RESULTS",
      endsAt: "2026-04-13T14:00:00.000Z",
    });

    mockLoadRoomState.mockResolvedValueOnce(expiredState).mockResolvedValueOnce(updatedState);
    mockEndRoundIfNeeded.mockResolvedValue({ status: "RESULTS" });

    vi.setSystemTime(new Date("2026-04-13T14:00:05.000Z"));

    const { GET } = await import("@/app/api/rooms/[roomId]/snapshot/route");
    const response = await GET(
      new NextRequest("http://localhost/api/rooms/ROOM1/snapshot?view=round"),
      { params: Promise.resolve({ roomId: "ROOM1" }) },
    );

    expect(mockEndRoundIfNeeded).toHaveBeenCalledWith({
      roomId: "ROOM1",
      roundId: "round-1",
    });
    expect(mockLoadRoomState).toHaveBeenCalledTimes(2);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      version: 2,
      snapshot: {
        room: {
          status: "RESULTS",
        },
      },
    });
  });

  it("does not advance rounds for non-expired snapshots", async () => {
    const activeState = createState({
      version: 1,
      status: "IN_ROUND",
      endsAt: "2026-04-13T14:05:00.000Z",
    });

    mockLoadRoomState.mockResolvedValue(activeState);
    vi.setSystemTime(new Date("2026-04-13T14:00:05.000Z"));

    const { GET } = await import("@/app/api/rooms/[roomId]/snapshot/route");
    const response = await GET(
      new NextRequest("http://localhost/api/rooms/ROOM1/snapshot?view=round"),
      { params: Promise.resolve({ roomId: "ROOM1" }) },
    );

    expect(mockEndRoundIfNeeded).not.toHaveBeenCalled();
    expect(mockLoadRoomState).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      version: 1,
      snapshot: {
        room: {
          status: "IN_ROUND",
        },
      },
    });
  });
});
