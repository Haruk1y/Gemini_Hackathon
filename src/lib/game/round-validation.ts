import { roundPrivateRef, roundRef, roomRef, playerRef } from "@/lib/api/paths";
import { requirePlayer, requireRoom } from "@/lib/game/guards";
import type { RoundPublicDoc } from "@/lib/types/game";
import { AppError } from "@/lib/utils/errors";
import { parseDate } from "@/lib/utils/time";

export async function assertRoundOpen(params: {
  roomId: string;
  roundId: string;
  uid: string;
}) {
  const [roomSnapshot, roundSnapshot, playerSnapshot, roundPrivateSnapshot] =
    await Promise.all([
      roomRef(params.roomId).get(),
      roundRef(params.roomId, params.roundId).get(),
      playerRef(params.roomId, params.uid).get(),
      roundPrivateRef(params.roomId, params.roundId).get(),
    ]);

  const room = requireRoom(roomSnapshot);
  const player = requirePlayer(playerSnapshot);

  if (!roundSnapshot.exists) {
    throw new AppError("ROUND_NOT_FOUND", "Round does not exist", false, 404);
  }

  if (!roundPrivateSnapshot.exists) {
    throw new AppError("ROUND_NOT_FOUND", "Round private data missing", false, 404);
  }

  const round = roundSnapshot.data() as RoundPublicDoc;

  if (room.status !== "IN_ROUND") {
    throw new AppError("ROUND_CLOSED", "Room is not in round state", false, 409);
  }

  if (room.currentRoundId !== params.roundId) {
    throw new AppError("ROUND_CLOSED", "This round is not active", false, 409);
  }

  const endsAt = parseDate(round.endsAt);
  if (!endsAt || Date.now() >= endsAt.getTime()) {
    throw new AppError("ROUND_CLOSED", "Round already ended", false, 409);
  }

  const promptStartsAt = parseDate(round.promptStartsAt);
  if (promptStartsAt && Date.now() < promptStartsAt.getTime()) {
    throw new AppError("ROUND_CLOSED", "まだプロンプト入力開始前です。", false, 409);
  }

  return {
    room,
    round,
    player,
    roundPrivate: roundPrivateSnapshot.data() as {
      targetCaptionText: string;
      gmPrompt: string;
    },
  };
}
