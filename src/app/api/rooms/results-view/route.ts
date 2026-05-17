import { resultsViewSchema } from "@/lib/api/schemas";
import { withPostHandler, ok } from "@/lib/api/handler";
import { updateResultsView } from "@/lib/game/room-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withPostHandler(
  resultsViewSchema,
  async ({ body, auth }) => {
    const resultsView = await updateResultsView({
      roomId: body.roomId,
      uid: auth.uid,
      roundId: body.roundId,
      showTotalRanking: body.showTotalRanking,
    });

    return ok({ resultsView });
  },
);
