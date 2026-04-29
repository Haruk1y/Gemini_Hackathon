import { after } from "next/server";

import { endRoundIfNeededSchema } from "@/lib/api/schemas";
import { withPostHandler, ok } from "@/lib/api/handler";
import {
  endRoundIfNeeded,
  runImpostorCpuTurns,
} from "@/lib/game/round-service";
import { LANGUAGE_COOKIE_NAME, normalizeLanguage } from "@/lib/i18n/language";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = withPostHandler(
  endRoundIfNeededSchema,
  async ({ body, auth, request }) => {
    const language = normalizeLanguage(
      request.cookies.get(LANGUAGE_COOKIE_NAME)?.value,
    );

    const result = await endRoundIfNeeded({
      roomId: body.roomId,
      roundId: body.roundId,
      uid: auth.uid,
      draftPrompt: body.draftPrompt,
      forceResults: body.forceResults,
      language,
      scheduleCpuTurns: ({ roomId, roundId }) => {
        after(async () => {
          try {
            await runImpostorCpuTurns({ roomId, roundId });
          } catch (error) {
            console.error(
              "Deferred CPU turn execution failed after round timeout",
              error,
            );
          }
        });
      },
    });

    return ok({
      status: result.status,
      ...(result.consumedDraft ? { consumedDraft: true } : {}),
    });
  },
);
