import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  scheduledTasks,
  mockAfter,
  mockStartRound,
  mockSubmitImpostorTurn,
  mockEndRoundIfNeeded,
  mockRunImpostorCpuTurns,
  mockLoadRoomState,
} = vi.hoisted(() => {
  const queuedTasks: Array<() => Promise<void> | void> = [];

  return {
    scheduledTasks: queuedTasks,
    mockAfter: vi.fn((task: () => Promise<void> | void) => {
      queuedTasks.push(task);
    }),
    mockStartRound: vi.fn(),
    mockSubmitImpostorTurn: vi.fn(),
    mockEndRoundIfNeeded: vi.fn(),
    mockRunImpostorCpuTurns: vi.fn(),
    mockLoadRoomState: vi.fn(),
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

vi.mock("@/lib/game/round-service", () => ({
  startRound: mockStartRound,
  submitImpostorTurn: mockSubmitImpostorTurn,
  endRoundIfNeeded: mockEndRoundIfNeeded,
  runImpostorCpuTurns: mockRunImpostorCpuTurns,
}));

vi.mock("@/lib/server/room-state", () => ({
  bumpRoomVersion: vi.fn((state: unknown) => state),
  loadRoomState: mockLoadRoomState,
  saveRoomState: vi.fn(),
  withRoomLock: vi.fn(),
  withSubmitLock: vi.fn(),
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

describe("Art Impostor CPU after() scheduling routes", () => {
  beforeEach(() => {
    vi.resetModules();
    scheduledTasks.length = 0;
    mockAfter.mockClear();
    mockStartRound.mockReset();
    mockSubmitImpostorTurn.mockReset();
    mockEndRoundIfNeeded.mockReset();
    mockRunImpostorCpuTurns.mockReset();
    mockLoadRoomState.mockReset();

    mockRunImpostorCpuTurns.mockResolvedValue(undefined);
  });

  it("schedules cpu continuation after /api/rounds/start responds", async () => {
    mockStartRound.mockImplementation(async (params: {
      roomId: string;
      scheduleCpuTurns?: (scheduled: { roomId: string; roundId: string }) => Promise<void> | void;
    }) => {
      await params.scheduleCpuTurns?.({
        roomId: params.roomId,
        roundId: "round-1",
      });
      return {
        roundId: "round-1",
        roundIndex: 1,
      };
    });

    const { POST } = await import("@/app/api/rounds/start/route");
    const response = await POST(
      createRequest("http://localhost/api/rounds/start", {
        roomId: "ROOM1",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      roundId: "round-1",
      roundIndex: 1,
    });
    expect(mockAfter).toHaveBeenCalledTimes(1);
    expect(mockRunImpostorCpuTurns).not.toHaveBeenCalled();

    await scheduledTasks[0]?.();

    expect(mockRunImpostorCpuTurns).toHaveBeenCalledWith({
      roomId: "ROOM1",
      roundId: "round-1",
    });
  });

  it("schedules cpu continuation after /api/rounds/submit responds", async () => {
    mockLoadRoomState
      .mockResolvedValueOnce({
        room: {
          settings: {
            gameMode: "impostor",
          },
        },
      })
      .mockResolvedValueOnce({
        roundPrivates: {
          "round-1": {
            modeState: {
              turnRecords: [
                {
                  uid: "anon_1",
                  similarityScore: 73,
                  imageUrl: "https://example.com/turn.png",
                  matchedElements: ["subject"],
                  missingElements: ["background"],
                  judgeNote: "mock judge",
                },
              ],
            },
          },
        },
      });

    mockSubmitImpostorTurn.mockImplementation(async (params: {
      roomId: string;
      roundId: string;
      scheduleCpuTurns?: (scheduled: { roomId: string; roundId: string }) => Promise<void> | void;
    }) => {
      await params.scheduleCpuTurns?.({
        roomId: params.roomId,
        roundId: params.roundId,
      });
    });

    const { POST } = await import("@/app/api/rounds/submit/route");
    const response = await POST(
      createRequest("http://localhost/api/rounds/submit", {
        roomId: "ROOM1",
        roundId: "round-1",
        prompt: "human prompt",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      score: 73,
      imageUrl: "https://example.com/turn.png",
    });
    expect(mockAfter).toHaveBeenCalledTimes(1);
    expect(mockRunImpostorCpuTurns).not.toHaveBeenCalled();

    await scheduledTasks[0]?.();

    expect(mockRunImpostorCpuTurns).toHaveBeenCalledWith({
      roomId: "ROOM1",
      roundId: "round-1",
    });
  });

  it("schedules cpu continuation after /api/rounds/endIfNeeded responds", async () => {
    mockEndRoundIfNeeded.mockImplementation(async (params: {
      roomId: string;
      roundId: string;
      scheduleCpuTurns?: (scheduled: { roomId: string; roundId: string }) => Promise<void> | void;
    }) => {
      await params.scheduleCpuTurns?.({
        roomId: params.roomId,
        roundId: params.roundId,
      });
      return {
        status: "IN_ROUND" as const,
      };
    });

    const { POST } = await import("@/app/api/rounds/endIfNeeded/route");
    const response = await POST(
      createRequest("http://localhost/api/rounds/endIfNeeded", {
        roomId: "ROOM1",
        roundId: "round-1",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      status: "IN_ROUND",
    });
    expect(mockAfter).toHaveBeenCalledTimes(1);
    expect(mockRunImpostorCpuTurns).not.toHaveBeenCalled();

    await scheduledTasks[0]?.();

    expect(mockRunImpostorCpuTurns).toHaveBeenCalledWith({
      roomId: "ROOM1",
      roundId: "round-1",
    });
  });
});
