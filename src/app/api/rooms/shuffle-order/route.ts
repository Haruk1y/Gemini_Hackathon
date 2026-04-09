import { roomOnlySchema } from "@/lib/api/schemas";
import { withPostHandler, ok } from "@/lib/api/handler";
import { shufflePlayerOrder } from "@/lib/game/room-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withPostHandler(roomOnlySchema, async ({ body, auth }) => {
  const order = await shufflePlayerOrder({
    roomId: body.roomId,
    uid: auth.uid,
  });

  return ok({
    order,
  });
});
