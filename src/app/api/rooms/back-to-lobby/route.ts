import { roomOnlySchema } from "@/lib/api/schemas";
import { withPostHandler, ok } from "@/lib/api/handler";
import { assertHost, requirePlayer, requireRoom } from "@/lib/game/guards";
import { resetRoomForReplay } from "@/lib/game/round-service";
import { loadRoomState } from "@/lib/server/room-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withPostHandler(roomOnlySchema, async ({ body, auth }) => {
  const state = await loadRoomState(body.roomId);
  requireRoom(state?.room);
  const player = requirePlayer(state?.players[auth.uid]);
  assertHost(player);

  await resetRoomForReplay(body.roomId);
  return ok({ returned: true });
});
