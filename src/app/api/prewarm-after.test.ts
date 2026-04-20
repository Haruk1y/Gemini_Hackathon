import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  scheduledTasks,
  mockAfter,
  mockCreateRoomCode,
  mockCreateRoomState,
  mockEnsurePreparedRound,
  mockLoadRoomState,
  mockResetRoomForReplay,
  mockRoomStateExists,
  mockSaveRoomState,
  mockStartRound,
} = vi.hoisted(() => {
  const queuedTasks: Array<() => Promise<void> | void> = [];

  return {
    scheduledTasks: queuedTasks,
    mockAfter: vi.fn((task: () => Promise<void> | void) => {
      queuedTasks.push(task);
    }),
    mockCreateRoomCode: vi.fn(() => "ROOM1"),
    mockCreateRoomState: vi.fn((room: unknown) => ({
      room,
      players: {},
      rounds: {},
      roundPrivates: {},
      attempts: {},
      scores: {},
      preparedRound: null,
      roundSequence: 0,
      version: 1,
    })),
    mockEnsurePreparedRound: vi.fn(),
    mockLoadRoomState: vi.fn(),
    mockResetRoomForReplay: vi.fn(),
    mockRoomStateExists: vi.fn(async () => false),
    mockSaveRoomState: vi.fn(),
    mockStartRound: vi.fn(),
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
  verifySessionCookie: vi.fn(() => ({ uid: "anon_1", issuedAt: Date.now() })),
}));

vi.mock("@/lib/utils/id", () => ({
  createRoomCode: mockCreateRoomCode,
}));

vi.mock("@/lib/game/round-service", () => ({
  ensurePreparedRound: mockEnsurePreparedRound,
  resetRoomForReplay: mockResetRoomForReplay,
  startRound: mockStartRound,
}));

vi.mock("@/lib/server/room-state", () => ({
  createRoomState: mockCreateRoomState,
  getRoomStateBackendInfo: vi.fn(() => ({ kind: "memory", envSource: null })),
  loadRoomState: mockLoadRoomState,
  roomStateExists: mockRoomStateExists,
  saveRoomState: mockSaveRoomState,
}));

function createRequest(url: string, body: Record<string, unknown>) {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "session=placeholder",
    },
    body: JSON.stringify(body),
  });
}

function hostRoomState(params?: { roundIndex?: number; totalRounds?: number }) {
  return {
    room: {
      roomId: "ROOM1",
      status: "RESULTS",
      roundIndex: params?.roundIndex ?? 1,
      settings: {
        totalRounds: params?.totalRounds ?? 3,
      },
    },
    players: {
      "anon_1": {
        uid: "anon_1",
        isHost: true,
      },
    },
  };
}

describe("prewarm after() scheduling routes", () => {
  beforeEach(() => {
    vi.resetModules();
    scheduledTasks.length = 0;
    mockAfter.mockClear();
    mockCreateRoomCode.mockClear();
    mockCreateRoomState.mockClear();
    mockEnsurePreparedRound.mockReset();
    mockLoadRoomState.mockReset();
    mockResetRoomForReplay.mockReset();
    mockRoomStateExists.mockReset();
    mockSaveRoomState.mockReset();
    mockStartRound.mockReset();
    mockRoomStateExists.mockResolvedValue(false);
  });

  it("schedules the first round prewarm after room creation", async () => {
    const { POST } = await import("@/app/api/rooms/create/route");
    const response = await POST(
      createRequest("http://localhost/api/rooms/create", {
        displayName: "Host",
      }),
    );

    expect(response.status).toBe(200);
    expect(mockSaveRoomState).toHaveBeenCalledTimes(1);
    expect(mockAfter).toHaveBeenCalledTimes(1);

    await Promise.all(scheduledTasks.map((task) => task?.()));

    expect(mockEnsurePreparedRound).toHaveBeenCalledWith({
      roomId: "ROOM1",
    });
  });

  it("schedules replay prewarm after returning to the lobby", async () => {
    mockLoadRoomState.mockResolvedValue(hostRoomState());

    const { POST } = await import("@/app/api/rooms/back-to-lobby/route");
    const response = await POST(
      createRequest("http://localhost/api/rooms/back-to-lobby", {
        roomId: "ROOM1",
      }),
    );

    expect(response.status).toBe(200);
    expect(mockResetRoomForReplay).toHaveBeenCalledWith("ROOM1");
    expect(mockAfter).toHaveBeenCalledTimes(1);

    await Promise.all(scheduledTasks.map((task) => task?.()));

    expect(mockEnsurePreparedRound).toHaveBeenCalledWith({
      roomId: "ROOM1",
    });
  });

  it("schedules the next round prewarm after starting another round", async () => {
    mockLoadRoomState.mockResolvedValue(hostRoomState({ roundIndex: 1, totalRounds: 3 }));
    mockStartRound.mockResolvedValue({
      roundId: "round-2",
      roundIndex: 2,
    });

    const { POST } = await import("@/app/api/rounds/next/route");
    const response = await POST(
      createRequest("http://localhost/api/rounds/next", {
        roomId: "ROOM1",
      }),
    );

    expect(response.status).toBe(200);
    expect(mockStartRound).toHaveBeenCalledWith({
      roomId: "ROOM1",
      uid: "anon_1",
    });
    expect(mockAfter).toHaveBeenCalledTimes(1);

    await Promise.all(scheduledTasks.map((task) => task?.()));

    expect(mockEnsurePreparedRound).toHaveBeenCalledWith({
      roomId: "ROOM1",
    });
  });

  it("schedules replay prewarm after the final round resets the room", async () => {
    mockLoadRoomState.mockResolvedValue(hostRoomState({ roundIndex: 3, totalRounds: 3 }));

    const { POST } = await import("@/app/api/rounds/next/route");
    const response = await POST(
      createRequest("http://localhost/api/rounds/next", {
        roomId: "ROOM1",
      }),
    );

    expect(response.status).toBe(200);
    expect(mockResetRoomForReplay).toHaveBeenCalledWith("ROOM1");
    expect(mockAfter).toHaveBeenCalledTimes(1);

    await Promise.all(scheduledTasks.map((task) => task?.()));

    expect(mockEnsurePreparedRound).toHaveBeenCalledWith({
      roomId: "ROOM1",
    });
  });
});
