import { readySchema } from "@/lib/api/schemas";
import { withPostHandler, ok } from "@/lib/api/handler";
import { playerRef, roomRef } from "@/lib/api/paths";
import { requirePlayer, requireRoom } from "@/lib/game/guards";
import { AppError } from "@/lib/utils/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withPostHandler(readySchema, async ({ body, auth }) => {
  const roomSnapshot = await roomRef(body.roomId).get();
  requireRoom(roomSnapshot);

  const playerSnapshot = await playerRef(body.roomId, auth.uid).get();
  const player = requirePlayer(playerSnapshot);

  if (!body.ready) {
    throw new AppError("VALIDATION_ERROR", "Unready is disabled in this lobby", false, 409);
  }

  if (player.ready) {
    return ok({ updated: false, ready: true });
  }

  await playerRef(body.roomId, auth.uid).update({
    ready: true,
    lastSeenAt: new Date(),
  });

  return ok({ updated: true, ready: true });
});
