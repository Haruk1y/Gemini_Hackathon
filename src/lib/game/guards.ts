import type { PlayerDoc, RoomDoc } from "@/lib/types/game";
import { AppError } from "@/lib/utils/errors";

export function requireRoom(room: RoomDoc | null | undefined): RoomDoc {
  if (!room) {
    throw new AppError("ROOM_NOT_FOUND", "Room does not exist", false, 404);
  }

  return room;
}

export function requirePlayer(player: PlayerDoc | null | undefined): PlayerDoc {
  if (!player) {
    throw new AppError("PLAYER_NOT_FOUND", "Player does not exist", false, 404);
  }

  return player;
}

export function assertHost(player: PlayerDoc): void {
  if (!player.isHost) {
    throw new AppError("NOT_HOST", "Only host can perform this action", false, 403);
  }
}
