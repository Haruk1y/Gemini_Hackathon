import { voteSchema } from "@/lib/api/schemas";
import { withPostHandler, ok } from "@/lib/api/handler";
import { voteInRound } from "@/lib/game/round-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withPostHandler(voteSchema, async ({ body, auth }) => {
  const result = await voteInRound({
    roomId: body.roomId,
    roundId: body.roundId,
    uid: auth.uid,
    targetUid: body.targetUid,
  });

  return ok(result);
});
