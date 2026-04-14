import { after } from "next/server";

import { roundSchema } from "@/lib/api/schemas";
import { withPostHandler, ok } from "@/lib/api/handler";
import { endRoundIfNeeded, runImpostorCpuTurns } from "@/lib/game/round-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withPostHandler(roundSchema, async ({ body }) => {
  const result = await endRoundIfNeeded({
    roomId: body.roomId,
    roundId: body.roundId,
    scheduleCpuTurns: ({ roomId, roundId }) => {
      after(async () => {
        try {
          await runImpostorCpuTurns({ roomId, roundId });
        } catch (error) {
          console.error("Deferred CPU turn execution failed after round timeout", error);
        }
      });
    },
  });

  return ok({ status: result.status });
});
