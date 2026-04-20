import { after } from "next/server";

import { roomOnlySchema } from "@/lib/api/schemas";
import { withPostHandler, ok } from "@/lib/api/handler";
import { assertHost, requirePlayer, requireRoom } from "@/lib/game/guards";
import { ensurePreparedRound, resetRoomForReplay } from "@/lib/game/round-service";
import { loadRoomState } from "@/lib/server/room-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = withPostHandler(roomOnlySchema, async ({ body, auth }) => {
  const state = await loadRoomState(body.roomId);
  requireRoom(state?.room);
  const player = requirePlayer(state?.players[auth.uid]);
  assertHost(player);

  await resetRoomForReplay(body.roomId);
  after(async () => {
    try {
      await ensurePreparedRound({ roomId: body.roomId });
    } catch (error) {
      console.error("Deferred round preparation failed after lobby reset", error);
    }
  });
  return ok({ returned: true });
});
