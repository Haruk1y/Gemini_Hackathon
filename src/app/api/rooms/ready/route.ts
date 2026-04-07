import { readySchema } from "@/lib/api/schemas";
import { withPostHandler, ok } from "@/lib/api/handler";
import { playerRef, roomRef } from "@/lib/api/paths";
import { requirePlayer, requireRoom } from "@/lib/game/guards";
import { AppError } from "@/lib/utils/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withPostHandler(readySchema, async ({ body, auth }) => {
  const roomSnapshot = await roomRef(body.roomId).get();
  const room = requireRoom(roomSnapshot);

  if (room.status !== "LOBBY") {
    throw new AppError("VALIDATION_ERROR", "READY状態を変更できるのはロビー中だけです。", false, 409);
  }

  const playerSnapshot = await playerRef(body.roomId, auth.uid).get();
  const player = requirePlayer(playerSnapshot);

  if (player.ready === body.ready) {
    return ok({ updated: false, ready: player.ready });
  }

  await playerRef(body.roomId, auth.uid).update({
    ready: body.ready,
    lastSeenAt: new Date(),
  });

  return ok({ updated: true, ready: body.ready });
});
