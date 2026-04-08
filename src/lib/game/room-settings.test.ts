import { beforeEach, describe, expect, it } from "vitest";

import { updateRoomSettings } from "@/lib/game/room-service";
import {
  createRoomState,
  loadRoomState,
  saveRoomState,
  __test__ as roomStateTest,
} from "@/lib/server/room-state";
import { dateAfterHours } from "@/lib/utils/time";

function createBaseState() {
  const now = new Date("2026-04-07T10:00:00.000Z");
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
      imageModel: "flash",
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
    totalScore: 0,
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
    totalScore: 0,
  };

  return state;
}

describe("updateRoomSettings", () => {
  beforeEach(() => {
    roomStateTest.resetMemoryStore();
  });

  it("allows the host to update settings in the lobby", async () => {
    await saveRoomState(createBaseState());

    const settings = await updateRoomSettings({
      roomId: "ROOM1",
      uid: "host",
      settings: {
        gameMode: "memory",
        totalRounds: 3,
        roundSeconds: 45,
        cpuCount: 0,
      },
    });

    expect(settings.gameMode).toBe("memory");
    expect(settings.totalRounds).toBe(3);
    expect(settings.roundSeconds).toBe(45);
    expect(settings.maxAttempts).toBe(1);
    expect(settings.hintLimit).toBe(0);
  });

  it("syncs cpu players when impostor mode is enabled", async () => {
    await saveRoomState(createBaseState());

    await updateRoomSettings({
      roomId: "ROOM1",
      uid: "host",
      settings: {
        gameMode: "impostor",
        totalRounds: 3,
        roundSeconds: 60,
        cpuCount: 2,
      },
    });

    const state = await loadRoomState("ROOM1");
    const cpuPlayers = Object.values(state?.players ?? {}).filter((player) => player.kind === "cpu");

    expect(state?.room.settings.cpuCount).toBe(2);
    expect(cpuPlayers).toHaveLength(2);
    expect(cpuPlayers.every((player) => player.ready)).toBe(true);
  });

  it("prunes cpu players when leaving impostor mode", async () => {
    await saveRoomState(createBaseState());

    await updateRoomSettings({
      roomId: "ROOM1",
      uid: "host",
      settings: {
        gameMode: "impostor",
        totalRounds: 3,
        roundSeconds: 60,
        cpuCount: 2,
      },
    });

    await updateRoomSettings({
      roomId: "ROOM1",
      uid: "host",
      settings: {
        gameMode: "classic",
        totalRounds: 3,
        roundSeconds: 60,
        cpuCount: 0,
      },
    });

    const state = await loadRoomState("ROOM1");
    const cpuPlayers = Object.values(state?.players ?? {}).filter((player) => player.kind === "cpu");

    expect(state?.room.settings.cpuCount).toBe(0);
    expect(cpuPlayers).toHaveLength(0);
  });

  it("rejects non-host players", async () => {
    await saveRoomState(createBaseState());

    await expect(
      updateRoomSettings({
        roomId: "ROOM1",
        uid: "guest",
        settings: {
          gameMode: "memory",
          totalRounds: 2,
          roundSeconds: 30,
          cpuCount: 0,
        },
      }),
    ).rejects.toMatchObject({
      code: "NOT_HOST",
      status: 403,
    });
  });

  it("rejects updates outside the lobby", async () => {
    const state = createBaseState();
    state.room.status = "IN_ROUND";
    await saveRoomState(state);

    await expect(
      updateRoomSettings({
        roomId: "ROOM1",
        uid: "host",
        settings: {
          gameMode: "memory",
          totalRounds: 2,
          roundSeconds: 30,
          cpuCount: 0,
        },
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 409,
    });
  });
});
