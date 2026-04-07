import { readySchema } from "@/lib/api/schemas";
import { withPostHandler, ok } from "@/lib/api/handler";
import { requirePlayer, requireRoom } from "@/lib/game/guards";
import {
  bumpRoomVersion,
  loadRoomState,
  saveRoomState,
  withRoomLock,
} from "@/lib/server/room-state";
import { AppError } from "@/lib/utils/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withPostHandler(readySchema, async ({ body, auth }) => {
  return withRoomLock(body.roomId, async () => {
    const state = await loadRoomState(body.roomId);
    const room = requireRoom(state?.room);

    if (room.status !== "LOBBY") {
      throw new AppError("VALIDATION_ERROR", "READY状態を変更できるのはロビー中だけです。", false, 409);
    }

    const player = requirePlayer(state?.players[auth.uid]);

    if (player.ready === body.ready) {
      return ok({ updated: false, ready: player.ready });
    }

    player.ready = body.ready;
    player.lastSeenAt = new Date();
    await saveRoomState(bumpRoomVersion(state!));

    return ok({ updated: true, ready: body.ready });
  });
});
