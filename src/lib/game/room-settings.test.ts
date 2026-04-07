import { beforeEach, describe, expect, it, vi } from "vitest";

const roomRef = vi.fn();
const playerRef = vi.fn();
const playersRef = vi.fn();

vi.mock("@/lib/api/paths", () => ({
  roomRef,
  playerRef,
  playersRef,
}));

vi.mock("@/lib/google-cloud/admin", () => ({
  getAdminDb: vi.fn(() => ({})),
}));

function doc<T>(value: T) {
  return {
    exists: true,
    data: () => value,
  };
}

const baseRoom = {
  roomId: "ROOM1",
  code: "ROOM1",
  status: "LOBBY" as const,
  currentRoundId: null,
  roundIndex: 0,
  settings: {
    maxPlayers: 8,
    roundSeconds: 60,
    maxAttempts: 1,
    aspectRatio: "1:1" as const,
    imageModel: "flash" as const,
    hintLimit: 0,
    totalRounds: 3,
    gameMode: "classic" as const,
  },
};

const hostPlayer = {
  uid: "host",
  displayName: "Host",
  isHost: true,
  ready: true,
  totalScore: 0,
};

describe("updateRoomSettings", () => {
  beforeEach(() => {
    vi.resetModules();
    roomRef.mockReset();
    playerRef.mockReset();
    playersRef.mockReset();
  });

  it("allows the host to update settings in the lobby", async () => {
    const roomGet = vi.fn().mockResolvedValue(doc(baseRoom));
    const roomUpdate = vi.fn().mockResolvedValue(undefined);
    roomRef.mockReturnValue({
      get: roomGet,
      update: roomUpdate,
    });
    playerRef.mockReturnValue({
      get: vi.fn().mockResolvedValue(doc(hostPlayer)),
    });

    const { updateRoomSettings } = await import("@/lib/game/room-service");
    const settings = await updateRoomSettings({
      roomId: "ROOM1",
      uid: "host",
      settings: {
        gameMode: "memory",
        totalRounds: 3,
        roundSeconds: 45,
      },
    });

    expect(roomUpdate).toHaveBeenCalledWith({
      settings: expect.objectContaining({
        gameMode: "memory",
        totalRounds: 3,
        roundSeconds: 45,
        maxAttempts: 1,
        hintLimit: 0,
      }),
    });
    expect(settings.gameMode).toBe("memory");
    expect(settings.totalRounds).toBe(3);
    expect(settings.roundSeconds).toBe(45);
  });

  it("rejects non-host players", async () => {
    roomRef.mockReturnValue({
      get: vi.fn().mockResolvedValue(doc(baseRoom)),
      update: vi.fn(),
    });
    playerRef.mockReturnValue({
      get: vi.fn().mockResolvedValue(
        doc({
          ...hostPlayer,
          isHost: false,
        }),
      ),
    });

    const { updateRoomSettings } = await import("@/lib/game/room-service");

    await expect(
      updateRoomSettings({
        roomId: "ROOM1",
        uid: "guest",
        settings: {
          gameMode: "memory",
          totalRounds: 2,
          roundSeconds: 30,
        },
      }),
    ).rejects.toMatchObject({
      code: "NOT_HOST",
      status: 403,
    });
  });

  it("rejects updates outside the lobby", async () => {
    roomRef.mockReturnValue({
      get: vi.fn().mockResolvedValue(
        doc({
          ...baseRoom,
          status: "IN_ROUND" as const,
        }),
      ),
      update: vi.fn(),
    });
    playerRef.mockReturnValue({
      get: vi.fn().mockResolvedValue(doc(hostPlayer)),
    });

    const { updateRoomSettings } = await import("@/lib/game/room-service");

    await expect(
      updateRoomSettings({
        roomId: "ROOM1",
        uid: "host",
        settings: {
          gameMode: "memory",
          totalRounds: 2,
          roundSeconds: 30,
        },
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 409,
    });
  });
});
