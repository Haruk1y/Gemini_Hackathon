import { draftSchema } from "@/lib/api/schemas";
import { ok, withPostHandler } from "@/lib/api/handler";
import { updateImpostorDraft } from "@/lib/game/round-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withPostHandler(draftSchema, async ({ body, auth }) => {
  await updateImpostorDraft({
    roomId: body.roomId,
    roundId: body.roundId,
    uid: auth.uid,
    prompt: body.prompt,
  });

  return ok({});
});
