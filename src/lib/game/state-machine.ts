import { AppError } from "@/lib/utils/errors";
import type { RoomStatus } from "@/lib/types/game";

const roomTransitions: Record<RoomStatus, RoomStatus[]> = {
  LOBBY: ["GENERATING_ROUND", "IN_ROUND"],
  GENERATING_ROUND: ["IN_ROUND"],
  IN_ROUND: ["RESULTS"],
  RESULTS: ["GENERATING_ROUND", "IN_ROUND", "FINISHED"],
  FINISHED: [],
};

export function assertRoomTransition(
  current: RoomStatus,
  next: RoomStatus,
): void {
  const allowed = roomTransitions[current] ?? [];
  if (!allowed.includes(next)) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Invalid status transition: ${current} -> ${next}`,
      false,
      400,
    );
  }
}
