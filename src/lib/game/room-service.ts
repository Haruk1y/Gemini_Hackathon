import { requirePlayer, requireRoom, assertHost } from "@/lib/game/guards";
import { mergeRoomSettings } from "@/lib/game/defaults";
import { CHANGE_MIN_PLAYERS } from "@/lib/game/change-mode";
import { sortPlayersBySeatOrder, syncCpuPlayers } from "@/lib/game/impostor";
import {
  bumpRoomVersion,
  loadRoomState,
  saveRoomState,
  withRoomLock,
} from "@/lib/server/room-state";
import type { PlayerDoc, PlayerKind, RoomSettings } from "@/lib/types/game";
import { AppError } from "@/lib/utils/errors";
import { parseDate } from "@/lib/utils/time";

interface HostCandidate {
  uid: string;
  isHost: boolean;
  kind: PlayerKind;
  joinedAt?: Date;
}

export function selectNextHost(candidates: HostCandidate[]): string | null {
  const humans = candidates.filter((candidate) => candidate.kind === "human");
  if (!humans.length) return null;

  const existingHost = humans.find((candidate) => candidate.isHost);
  if (existingHost) return existingHost.uid;

  const sorted = [...humans].sort((a, b) => {
    const at = parseDate(a.joinedAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bt = parseDate(b.joinedAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return at - bt;
  });

  return sorted[0]?.uid ?? null;
}

export function assertModeCompatibleSettings(
  settings: Pick<RoomSettings, "gameMode" | "imageModel">,
): void {
  if (settings.gameMode === "change" && settings.imageModel !== "gemini") {
    throw new AppError(
      "MODE_REQUIRES_GEMINI",
      "Change mode requires Gemini image editing.",
      false,
      409,
    );
  }
}

export function assertCanStartRound(
  players: Array<Pick<PlayerDoc, "ready">>,
  options?: { minPlayers?: number },
): void {
  const minPlayers = options?.minPlayers ?? 1;

  if (players.length < minPlayers) {
    throw new AppError(
      "VALIDATION_ERROR",
      `At least ${minPlayers} player${minPlayers === 1 ? "" : "s"} are required`,
      false,
      409,
    );
  }

  if (!players.every((player) => player.ready)) {
    throw new AppError("VALIDATION_ERROR", "All players must be ready", false, 409);
  }
}

export function shufflePlayers<T>(players: T[], random = Math.random): T[] {
  const next = [...players];

  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex]!, next[index]!];
  }

  return next;
}

export async function updateRoomSettings(params: {
  roomId: string;
  uid: string;
  settings: Pick<
    RoomSettings,
    "gameMode" | "totalRounds" | "roundSeconds" | "cpuCount"
  >;
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

    const nextSettings = mergeRoomSettings({
      ...room.settings,
      ...params.settings,
    });
    assertModeCompatibleSettings(nextSettings);
    const shouldInvalidatePreparedRound =
      room.settings.gameMode !== nextSettings.gameMode;
    room.settings = nextSettings;
    if (shouldInvalidatePreparedRound) {
      state!.preparedRound = null;
    }
    syncCpuPlayers(state!);

    await saveRoomState(bumpRoomVersion(state!));
    return room.settings;
  });
}

export const CHANGE_START_MIN_PLAYERS = CHANGE_MIN_PLAYERS;

export async function pingRoom(roomId: string, uid: string): Promise<void> {
  await withRoomLock(roomId, async () => {
    const state = await loadRoomState(roomId);
    requireRoom(state?.room);

    const player = requirePlayer(state?.players[uid]);
    player.lastSeenAt = new Date();

    await saveRoomState(state!);
  });
}

export async function shufflePlayerOrder(params: {
  roomId: string;
  uid: string;
}): Promise<string[]> {
  return withRoomLock(params.roomId, async () => {
    const state = await loadRoomState(params.roomId);
    const room = requireRoom(state?.room);
    const player = requirePlayer(state?.players[params.uid]);
    assertHost(player);

    if (room.status !== "LOBBY") {
      throw new AppError(
        "VALIDATION_ERROR",
        "プレイヤー順をシャッフルできるのはロビー中だけです。",
        false,
        409,
      );
    }

    const orderedPlayers = sortPlayersBySeatOrder(Object.values(state!.players));
    const shuffledPlayers = shufflePlayers(orderedPlayers);

    shuffledPlayers.forEach((candidate, index) => {
      const target = state!.players[candidate.uid];
      if (target) {
        target.seatOrder = index;
        target.lastSeenAt = new Date();
      }
    });

    await saveRoomState(bumpRoomVersion(state!));
    return shuffledPlayers.map((candidate) => candidate.uid);
  });
}

export async function leaveRoom(roomId: string, uid: string): Promise<void> {
  await withRoomLock(roomId, async () => {
    const state = await loadRoomState(roomId);
    const room = requireRoom(state?.room);
    const leavingPlayer = requirePlayer(state?.players[uid]);

    delete state!.players[uid];

    const players = Object.values(state!.players);
    const humanPlayers = players.filter((player) => player.kind === "human");
    if (!humanPlayers.length) {
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
        kind: player.kind,
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
