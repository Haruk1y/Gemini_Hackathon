import { roomOnlySchema } from "@/lib/api/schemas";
import { withPostHandler, ok } from "@/lib/api/handler";
import { requirePlayer, requireRoom } from "@/lib/game/guards";
import { resetRoomForReplay, startRound } from "@/lib/game/round-service";
import { loadRoomState } from "@/lib/server/room-state";
import { AppError } from "@/lib/utils/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withPostHandler(roomOnlySchema, async ({ body, auth }) => {
  const state = await loadRoomState(body.roomId);
  const room = requireRoom(state?.room);
  const player = requirePlayer(state?.players[auth.uid]);

  if (!player.isHost) {
    throw new AppError("NOT_HOST", "Only host can start next round", false, 403);
  }

  if (room.roundIndex >= room.settings.totalRounds) {
    await resetRoomForReplay(body.roomId);
    return ok({ finished: true, nextRoundId: null });
  }

  const result = await startRound({ roomId: body.roomId, uid: auth.uid });
  return ok({ finished: false, nextRoundId: result.roundId });
});
