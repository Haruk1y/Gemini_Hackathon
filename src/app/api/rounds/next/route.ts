import { roomOnlySchema } from "@/lib/api/schemas";
import { withPostHandler, ok } from "@/lib/api/handler";
import { roomRef, playerRef } from "@/lib/api/paths";
import { startRound, endGame } from "@/lib/game/round-service";
import { requirePlayer, requireRoom } from "@/lib/game/guards";
import { AppError } from "@/lib/utils/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withPostHandler(roomOnlySchema, async ({ body, auth }) => {
  const roomSnapshot = await roomRef(body.roomId).get();
  const room = requireRoom(roomSnapshot);

  const playerSnapshot = await playerRef(body.roomId, auth.uid).get();
  const player = requirePlayer(playerSnapshot);
  if (!player.isHost) {
    throw new AppError("NOT_HOST", "Only host can start next round", false, 403);
  }

  if (room.roundIndex >= room.settings.totalRounds) {
    await endGame(body.roomId);
    return ok({ finished: true, nextRoundId: null });
  }

  const result = await startRound({ roomId: body.roomId, uid: auth.uid });
  return ok({ finished: false, nextRoundId: result.roundId });
});
