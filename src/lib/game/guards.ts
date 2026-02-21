import type { DocumentSnapshot } from "firebase-admin/firestore";

import type { PlayerDoc, RoomDoc } from "@/lib/types/game";
import { AppError } from "@/lib/utils/errors";

export function requireRoom(snapshot: DocumentSnapshot): RoomDoc {
  if (!snapshot.exists) {
    throw new AppError("ROOM_NOT_FOUND", "Room does not exist", false, 404);
  }
  return snapshot.data() as RoomDoc;
}

export function requirePlayer(snapshot: DocumentSnapshot): PlayerDoc {
  if (!snapshot.exists) {
    throw new AppError("PLAYER_NOT_FOUND", "Player does not exist", false, 404);
  }
  return snapshot.data() as PlayerDoc;
}

export function assertHost(player: PlayerDoc): void {
  if (!player.isHost) {
    throw new AppError("NOT_HOST", "Only host can perform this action", false, 403);
  }
}
