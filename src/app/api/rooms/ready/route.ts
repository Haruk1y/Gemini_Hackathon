import { readySchema } from "@/lib/api/schemas";
import { withPostHandler, ok } from "@/lib/api/handler";
import { playerRef, roomRef } from "@/lib/api/paths";
import { requirePlayer, requireRoom } from "@/lib/game/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withPostHandler(readySchema, async ({ body, auth }) => {
  const roomSnapshot = await roomRef(body.roomId).get();
  requireRoom(roomSnapshot);

  const playerSnapshot = await playerRef(body.roomId, auth.uid).get();
  requirePlayer(playerSnapshot);

  await playerRef(body.roomId, auth.uid).update({
    ready: body.ready,
    lastSeenAt: new Date(),
  });

  return ok({ updated: true });
});
