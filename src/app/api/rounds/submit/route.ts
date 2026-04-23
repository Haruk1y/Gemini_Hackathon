import { after } from "next/server";

import { submitSchema } from "@/lib/api/schemas";
import { withPostHandler, ok } from "@/lib/api/handler";
import {
  submitClassicRoundAttempt,
  type ClassicRoundSubmitResult,
  type ClassicSubmitLogContext,
  type ClassicSubmitStage,
} from "@/lib/game/classic-submit";
import { runImpostorCpuTurns, submitImpostorTurn } from "@/lib/game/round-service";
import { LANGUAGE_COOKIE_NAME, normalizeLanguage } from "@/lib/i18n/language";
import { loadRoomState } from "@/lib/server/room-state";
import { AppError } from "@/lib/utils/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function summarizeError(error: unknown) {
  if (error instanceof AppError) {
    return {
      code: error.code,
      status: error.status,
      retryable: error.retryable,
      message: error.message,
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return {
    message: String(error),
  };
}

function logSubmitStageFailure(
  stage: ClassicSubmitStage,
  params: ClassicSubmitLogContext,
  error: unknown,
) {
  console.error("round submit stage failed", {
    stage,
    roomId: params.roomId,
    roundId: params.roundId,
    uid: params.uid,
    language: params.language,
    promptPreview: params.prompt.slice(0, 120),
    error: summarizeError(error),
  });
}

export const POST = withPostHandler(submitSchema, async ({ body, auth, request }) => {
  const currentState = await loadRoomState(body.roomId);
  const currentRoom = currentState?.room;
  const language = normalizeLanguage(
    request.cookies.get(LANGUAGE_COOKIE_NAME)?.value,
  );

  if (currentRoom?.settings.gameMode === "change") {
    throw new AppError(
      "VALIDATION_ERROR",
      "Change mode uses click submissions instead of text prompts.",
      false,
      409,
    );
  }

  if (currentRoom?.settings.gameMode === "impostor") {
    await submitImpostorTurn({
      roomId: body.roomId,
      roundId: body.roundId,
      uid: auth.uid,
      prompt: body.prompt,
      scheduleCpuTurns: ({ roomId, roundId }) => {
        after(async () => {
          try {
            await runImpostorCpuTurns({ roomId, roundId });
          } catch (error) {
            console.error("Deferred CPU turn execution failed after player submit", error);
          }
        });
      },
    });

    const updatedState = await loadRoomState(body.roomId);
    const turnRecords = updatedState?.roundPrivates[body.roundId]?.modeState?.turnRecords ?? [];
    const turnRecord = [...turnRecords]
      .reverse()
      .find((record) => record.uid === auth.uid);

    if (!turnRecord) {
      throw new AppError("INTERNAL_ERROR", "Failed to resolve impostor turn result", true, 500);
    }

    return ok({
      attemptNo: 1,
      score: turnRecord.similarityScore,
      imageUrl: turnRecord.imageUrl,
      bestScore: turnRecord.similarityScore,
      matchedElements: turnRecord.matchedElements,
      missingElements: turnRecord.missingElements,
      judgeNote: turnRecord.judgeNote,
    });
  }

  const result: ClassicRoundSubmitResult = await submitClassicRoundAttempt({
    roomId: body.roomId,
    roundId: body.roundId,
    uid: auth.uid,
    prompt: body.prompt,
    language,
    logStageFailure: logSubmitStageFailure,
  });

  return ok(result);
});
