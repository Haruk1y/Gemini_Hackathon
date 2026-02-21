import { roundSchema } from "@/lib/api/schemas";
import { withPostHandler, ok } from "@/lib/api/handler";
import { endRoundIfNeeded } from "@/lib/game/round-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withPostHandler(roundSchema, async ({ body }) => {
  const result = await endRoundIfNeeded({
    roomId: body.roomId,
    roundId: body.roundId,
  });

  return ok({ status: result.status });
});
