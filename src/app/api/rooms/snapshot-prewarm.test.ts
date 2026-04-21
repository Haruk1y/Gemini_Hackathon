import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  scheduledTasks,
  mockAfter,
  mockVerifySessionCookie,
  mockBuildRoomViewSnapshot,
  mockLoadRoomState,
  mockGetRoomStateBackendInfo,
  mockEndRoundIfNeeded,
  mockEnsurePreparedRound,
  mockShouldEnsurePreparedRound,
} = vi.hoisted(() => {
  const queuedTasks: Array<() => Promise<void> | void> = [];

  return {
    scheduledTasks: queuedTasks,
    mockAfter: vi.fn((task: () => Promise<void> | void) => {
      queuedTasks.push(task);
    }),
    mockVerifySessionCookie: vi.fn(),
    mockBuildRoomViewSnapshot: vi.fn(),
    mockLoadRoomState: vi.fn(),
    mockGetRoomStateBackendInfo: vi.fn(),
    mockEndRoundIfNeeded: vi.fn(),
    mockEnsurePreparedRound: vi.fn(),
    mockShouldEnsurePreparedRound: vi.fn(),
  };
});

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after: mockAfter,
  };
});

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
  ensurePreparedRound: mockEnsurePreparedRound,
  shouldEnsurePreparedRound: mockShouldEnsurePreparedRound,
}));

function createLobbyState() {
  return {
    version: 5,
    room: {
      roomId: "ROOM1",
      code: "ROOM1",
      status: "LOBBY",
      currentRoundId: null,
      roundIndex: 0,
      settings: {
        totalRounds: 3,
      },
    },
    rounds: {},
    roundPrivates: {},
    players: {
      host: {
        uid: "host",
      },
    },
    attempts: {},
    scores: {},
    preparedRound: {
      roundId: "round-1",
      index: 1,
      status: "FAILED",
    },
  };
}

describe("GET /api/rooms/[roomId]/snapshot prewarm retry", () => {
  beforeEach(() => {
    vi.resetModules();
    scheduledTasks.length = 0;
    mockAfter.mockClear();
    mockVerifySessionCookie.mockReset();
    mockBuildRoomViewSnapshot.mockReset();
    mockLoadRoomState.mockReset();
    mockGetRoomStateBackendInfo.mockReset();
    mockEndRoundIfNeeded.mockReset();
    mockEnsurePreparedRound.mockReset();
    mockShouldEnsurePreparedRound.mockReset();

    mockVerifySessionCookie.mockReturnValue({ uid: "host", issuedAt: Date.now() });
    mockGetRoomStateBackendInfo.mockReturnValue({
      kind: "memory",
      envSource: null,
    });
    mockLoadRoomState.mockResolvedValue(createLobbyState());
    mockBuildRoomViewSnapshot.mockReturnValue({
      room: {
        status: "LOBBY",
      },
      players: [],
      round: null,
      scores: [],
      attempts: null,
      playerCount: 0,
    });
  });

  it("retries prepared-round warming from lobby snapshot polling even on 204 responses", async () => {
    mockShouldEnsurePreparedRound.mockReturnValue(true);

    const { GET } = await import("@/app/api/rooms/[roomId]/snapshot/route");
    const response = await GET(
      new NextRequest("http://localhost/api/rooms/ROOM1/snapshot?view=lobby&since=5"),
      { params: Promise.resolve({ roomId: "ROOM1" }) },
    );

    expect(response.status).toBe(204);
    expect(mockAfter).toHaveBeenCalledTimes(1);

    await Promise.all(scheduledTasks.map((task) => task?.()));

    expect(mockEnsurePreparedRound).toHaveBeenCalledWith({
      roomId: "ROOM1",
    });
  });

  it("does not enqueue a retry while polling the round view", async () => {
    mockShouldEnsurePreparedRound.mockReturnValue(true);

    const { GET } = await import("@/app/api/rooms/[roomId]/snapshot/route");
    const response = await GET(
      new NextRequest("http://localhost/api/rooms/ROOM1/snapshot?view=round&since=5"),
      { params: Promise.resolve({ roomId: "ROOM1" }) },
    );

    expect(response.status).toBe(204);
    expect(mockAfter).not.toHaveBeenCalled();
    expect(mockEnsurePreparedRound).not.toHaveBeenCalled();
  });
});
