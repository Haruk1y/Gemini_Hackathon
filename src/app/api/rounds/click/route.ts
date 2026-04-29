import { after } from "next/server";

import { clickSchema } from "@/lib/api/schemas";
import { withPostHandler, ok } from "@/lib/api/handler";
import {
  endRoundIfNeeded,
  submitChangeRoundClick,
} from "@/lib/game/round-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = withPostHandler(clickSchema, async ({ body, auth }) => {
  const result = await submitChangeRoundClick({
    roomId: body.roomId,
    roundId: body.roundId,
    uid: auth.uid,
    point: {
      x: body.x,
      y: body.y,
    },
  });

  after(async () => {
    try {
      await endRoundIfNeeded({
        roomId: body.roomId,
        roundId: body.roundId,
      });
    } catch (error) {
      console.error("Deferred change endIfNeeded failed after click submit", error);
    }
  });

  return ok(result);
});
