import { roomOnlySchema } from "@/lib/api/schemas";
import { withPostHandler, ok } from "@/lib/api/handler";
import { leaveRoom } from "@/lib/game/room-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withPostHandler(roomOnlySchema, async ({ body, auth }) => {
  await leaveRoom(body.roomId, auth.uid);
  return ok({ left: true });
});
