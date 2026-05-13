import { roundSchema } from "@/lib/api/schemas";
import { withPostHandler, ok } from "@/lib/api/handler";
import { runImpostorCpuTurns } from "@/lib/game/round-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = withPostHandler(roundSchema, async ({ body }) => {
  await runImpostorCpuTurns({
    roomId: body.roomId,
    roundId: body.roundId,
  });

  return ok({});
});
