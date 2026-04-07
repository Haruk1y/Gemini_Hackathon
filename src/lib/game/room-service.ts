import { requirePlayer, requireRoom, assertHost } from "@/lib/game/guards";
import { mergeRoomSettings } from "@/lib/game/defaults";
import {
  bumpRoomVersion,
  loadRoomState,
  saveRoomState,
  withRoomLock,
} from "@/lib/server/room-state";
import type { PlayerDoc, RoomSettings } from "@/lib/types/game";
import { AppError } from "@/lib/utils/errors";
import { parseDate } from "@/lib/utils/time";

interface HostCandidate {
  uid: string;
  isHost: boolean;
  joinedAt?: Date;
}

export function selectNextHost(candidates: HostCandidate[]): string | null {
  if (!candidates.length) return null;

  const existingHost = candidates.find((candidate) => candidate.isHost);
  if (existingHost) return existingHost.uid;

  const sorted = [...candidates].sort((a, b) => {
    const at = parseDate(a.joinedAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bt = parseDate(b.joinedAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return at - bt;
  });

  return sorted[0]?.uid ?? null;
}

export function assertCanStartRound(players: Array<Pick<PlayerDoc, "ready">>): void {
  if (!players.length) {
    throw new AppError("VALIDATION_ERROR", "At least 1 player is required", false, 409);
  }

  if (!players.every((player) => player.ready)) {
    throw new AppError("VALIDATION_ERROR", "All players must be ready", false, 409);
  }
}

export async function updateRoomSettings(params: {
  roomId: string;
  uid: string;
  settings: Pick<RoomSettings, "gameMode" | "totalRounds" | "roundSeconds">;
}): Promise<RoomSettings> {
  return withRoomLock(params.roomId, async () => {
    const state = await loadRoomState(params.roomId);
    const room = requireRoom(state?.room);
    const player = requirePlayer(state?.players[params.uid]);
    assertHost(player);

    if (room.status !== "LOBBY") {
      throw new AppError(
        "VALIDATION_ERROR",
        "ルーム設定を変更できるのはロビー中だけです。",
        false,
        409,
      );
    }

    room.settings = mergeRoomSettings({
      ...room.settings,
      ...params.settings,
    });

    await saveRoomState(bumpRoomVersion(state!));
    return room.settings;
  });
}

export async function pingRoom(roomId: string, uid: string): Promise<void> {
  await withRoomLock(roomId, async () => {
    const state = await loadRoomState(roomId);
    requireRoom(state?.room);

    const player = requirePlayer(state?.players[uid]);
    player.lastSeenAt = new Date();

    await saveRoomState(state!);
  });
}

export async function leaveRoom(roomId: string, uid: string): Promise<void> {
  await withRoomLock(roomId, async () => {
    const state = await loadRoomState(roomId);
    const room = requireRoom(state?.room);
    const leavingPlayer = requirePlayer(state?.players[uid]);

    delete state!.players[uid];

    const players = Object.values(state!.players);
    if (!players.length) {
      room.status = "FINISHED";
      room.currentRoundId = null;
      await saveRoomState(bumpRoomVersion(state!));
      return;
    }

    if (!leavingPlayer.isHost) {
      await saveRoomState(bumpRoomVersion(state!));
      return;
    }

    const nextHostUid = selectNextHost(
      players.map((player) => ({
        uid: player.uid,
        isHost: player.isHost,
        joinedAt: parseDate(player.joinedAt) ?? undefined,
      })),
    );

    if (nextHostUid) {
      for (const player of players) {
        player.isHost = player.uid === nextHostUid;
      }
    }

    await saveRoomState(bumpRoomVersion(state!));
  });
}
