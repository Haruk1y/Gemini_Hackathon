import { requirePlayer, requireRoom } from "@/lib/game/guards";
import { loadRoomState } from "@/lib/server/room-state";
import type { RoomDoc, RoundPublicDoc } from "@/lib/types/game";
import { AppError } from "@/lib/utils/errors";
import { parseDate } from "@/lib/utils/time";

export function assertRoundSubmissionWindow(params: {
  room: Pick<RoomDoc, "status" | "currentRoundId">;
  round: Pick<RoundPublicDoc, "status" | "endsAt" | "promptStartsAt">;
  roundId: string;
  now?: Date;
  allowResults?: boolean;
}) {
  const allowedStatuses = params.allowResults ? ["IN_ROUND", "RESULTS"] : ["IN_ROUND"];

  if (!allowedStatuses.includes(params.room.status)) {
    throw new AppError("ROUND_CLOSED", "Room is not in round state", false, 409);
  }

  if (params.room.currentRoundId !== params.roundId) {
    throw new AppError("ROUND_CLOSED", "This round is not active", false, 409);
  }

  if (!allowedStatuses.includes(params.round.status)) {
    throw new AppError("ROUND_CLOSED", "Round is not active", false, 409);
  }

  const referenceTime = params.now ?? new Date();
  const endsAt = parseDate(params.round.endsAt);
  if (!endsAt || referenceTime.getTime() >= endsAt.getTime()) {
    throw new AppError("ROUND_CLOSED", "Round already ended", false, 409);
  }

  const promptStartsAt = parseDate(params.round.promptStartsAt);
  if (promptStartsAt && referenceTime.getTime() < promptStartsAt.getTime()) {
    throw new AppError("ROUND_CLOSED", "まだプロンプト入力開始前です。", false, 409);
  }
}

export async function assertRoundOpen(params: {
  roomId: string;
  roundId: string;
  uid: string;
  now?: Date;
}) {
  const state = await loadRoomState(params.roomId);
  const room = requireRoom(state?.room);
  const player = requirePlayer(state?.players[params.uid]);
  const round = state?.rounds[params.roundId] as RoundPublicDoc | undefined;
  const roundPrivate = state?.roundPrivates[params.roundId];

  if (!round) {
    throw new AppError("ROUND_NOT_FOUND", "Round does not exist", false, 404);
  }

  if (!roundPrivate) {
    throw new AppError("ROUND_NOT_FOUND", "Round private data missing", false, 404);
  }

  assertRoundSubmissionWindow({
    room,
    round,
    roundId: params.roundId,
    now: params.now,
  });

  return {
    state,
    room,
    round,
    player,
    roundPrivate,
  };
}
