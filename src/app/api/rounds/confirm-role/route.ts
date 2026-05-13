import { withPostHandler, ok } from "@/lib/api/handler";
import { roleConfirmSchema } from "@/lib/api/schemas";
import { confirmImpostorRole } from "@/lib/game/round-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withPostHandler(
  roleConfirmSchema,
  async ({ body, auth }) => {
    await confirmImpostorRole({
      roomId: body.roomId,
      roundId: body.roundId,
      uid: auth.uid,
    });

    return ok({});
  },
);
