import { roomOnlySchema } from "@/lib/api/schemas";
import { withPostHandler, ok } from "@/lib/api/handler";
import { startRound } from "@/lib/game/round-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withPostHandler(roomOnlySchema, async ({ body, auth }) => {
  const result = await startRound({ roomId: body.roomId, uid: auth.uid });
  return ok({ roundId: result.roundId, roundIndex: result.roundIndex });
});
