import { after } from "next/server";

import { roomOnlySchema } from "@/lib/api/schemas";
import { withPostHandler, ok } from "@/lib/api/handler";
import {
  ensurePreparedRound,
  runImpostorCpuTurns,
  startRound,
} from "@/lib/game/round-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = withPostHandler(roomOnlySchema, async ({ body, auth }) => {
  const result = await startRound({
    roomId: body.roomId,
    uid: auth.uid,
    scheduleCpuTurns: ({ roomId, roundId }) => {
      after(async () => {
        try {
          await runImpostorCpuTurns({ roomId, roundId });
        } catch (error) {
          console.error("Deferred CPU turn execution failed after round start", error);
        }
      });
    },
  });
  after(async () => {
    try {
      await ensurePreparedRound({ roomId: body.roomId });
    } catch (error) {
      console.error("Deferred round preparation failed after round start", error);
    }
  });
  return ok({ roundId: result.roundId, roundIndex: result.roundIndex });
});
