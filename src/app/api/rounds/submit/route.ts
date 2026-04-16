import { after } from "next/server";

import { submitSchema } from "@/lib/api/schemas";
import { withPostHandler, ok } from "@/lib/api/handler";
import { RESULTS_GRACE_SECONDS } from "@/lib/game/modes";
import { assertRoundSubmissionWindow } from "@/lib/game/round-validation";
import { runImpostorCpuTurns, submitImpostorTurn } from "@/lib/game/round-service";
import {
  fallbackJudgeNote,
  generateImage,
  imageToBuffer,
  imageToPublicUrl,
  scoreImageSimilarity,
  type GeneratedImage,
} from "@/lib/gemini/client";
import { LANGUAGE_COOKIE_NAME, normalizeLanguage } from "@/lib/i18n/language";
import {
  bumpRoomVersion,
  loadRoomState,
  saveRoomState,
  withRoomLock,
  withSubmitLock,
} from "@/lib/server/room-state";
import { buildPlayerBestImagePath } from "@/lib/storage/paths";
import { uploadImageToStorage } from "@/lib/storage/upload-image";
import { AppError } from "@/lib/utils/errors";
import { dateAfterHours, parseDate } from "@/lib/utils/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  stage:
    | "image_generation"
    | "judge_prep"
    | "visual_scoring"
    | "storage_upload",
  params: {
    roomId: string;
    roundId: string;
    uid: string;
    prompt: string;
    language: string;
  },
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

interface SubmitResponse extends Record<string, unknown> {
  attemptNo: number;
  score: number;
  imageUrl: string;
  bestScore: number;
  matchedElements: string[];
  missingElements: string[];
  judgeNote: string;
}

async function fetchImageBytes(url: string): Promise<GeneratedImage | null> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    const mimeType = response.headers.get("content-type")?.split(";")[0] ?? "image/png";
    const arrayBuffer = await response.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString("base64");
    return {
      mimeType,
      base64Data,
      directUrl: url,
    };
  } catch (error) {
    console.warn("fetchImageBytes failed", url, error);
    return null;
  }
}

async function imageForVisualScoring(
  image: GeneratedImage,
  fallbackUrl?: string,
): Promise<GeneratedImage | null> {
  if (image.base64Data) {
    return image;
  }

  const url = fallbackUrl ?? image.directUrl;
  if (!url) return null;
  return fetchImageBytes(url);
}

async function resolveBestImageUrl(params: {
  roomId: string;
  roundId: string;
  uid: string;
  prompt: string;
  image: GeneratedImage;
}): Promise<string> {
  const directUrl = imageToPublicUrl(params.image, params.prompt);
  const imageBuffer = imageToBuffer(params.image);

  if (!imageBuffer || !params.image.base64Data) {
    if (!directUrl) {
      throw new AppError("GEMINI_ERROR", "Failed to resolve generated image URL", true, 502);
    }
    return directUrl;
  }

  try {
    return await uploadImageToStorage({
      path: buildPlayerBestImagePath(params.roomId, params.roundId, params.uid),
      buffer: imageBuffer,
      mimeType: params.image.mimeType,
    });
  } catch (error) {
    console.warn("Best image storage upload fallback", params.roomId, params.roundId, error);
    if (!directUrl) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError("GEMINI_ERROR", "Failed to resolve generated image URL", true, 502);
    }
    return directUrl;
  }
}

interface ReservedAttempt {
  attemptNo: number;
  createdAt: Date;
  aspectRatio: "1:1" | "16:9" | "9:16";
  targetImageUrl: string;
}

async function reserveRoundAttempt(params: {
  roomId: string;
  roundId: string;
  uid: string;
  prompt: string;
  submitStartedAt: Date;
}): Promise<ReservedAttempt> {
  return withRoomLock(params.roomId, async () => {
    const state = await loadRoomState(params.roomId);
    const room = state?.room;
    const round = state?.rounds[params.roundId];

    if (!state || !room || !round || !state.players[params.uid]) {
      throw new AppError("INTERNAL_ERROR", "Failed to reserve round attempt", true, 500);
    }

    assertRoundSubmissionWindow({
      room,
      round,
      roundId: params.roundId,
      now: params.submitStartedAt,
    });

    const roundAttempts = state.attempts[params.roundId] ?? {};
    const priorAttempts = roundAttempts[params.uid];
    if ((priorAttempts?.attemptsUsed ?? 0) >= room.settings.maxAttempts) {
      throw new AppError("MAX_ATTEMPTS_REACHED", "No attempts left", false, 409);
    }

    const attemptNo = (priorAttempts?.attemptsUsed ?? 0) + 1;
    const createdAt = new Date();

    state.attempts[params.roundId] = {
      ...roundAttempts,
      [params.uid]: {
        uid: params.uid,
        roundId: params.roundId,
        expiresAt: dateAfterHours(24),
        attemptsUsed: attemptNo,
        hintUsed: priorAttempts?.hintUsed ?? 0,
        bestScore: priorAttempts?.bestScore ?? 0,
        bestAttemptNo: priorAttempts?.bestAttemptNo ?? null,
        attempts: [
          ...(priorAttempts?.attempts ?? []).filter(
            (attempt) => attempt.attemptNo !== attemptNo,
          ),
          {
            attemptNo,
            prompt: params.prompt,
            imageUrl: "",
            score: null,
            status: "SCORING",
            createdAt,
          },
        ],
        updatedAt: createdAt,
      },
    };

    await saveRoomState(bumpRoomVersion(state));

    return {
      attemptNo,
      createdAt,
      aspectRatio: room.settings.aspectRatio,
      targetImageUrl: round.targetImageUrl,
    };
  });
}

export async function rollbackReservedAttempt(params: {
  roomId: string;
  roundId: string;
  uid: string;
  attemptNo: number;
}) {
  await withRoomLock(params.roomId, async () => {
    const state = await loadRoomState(params.roomId);
    const roundAttempts = state?.attempts[params.roundId];
    const reservedDoc = roundAttempts?.[params.uid];

    if (!state || !roundAttempts || !reservedDoc) {
      return;
    }

    const nextAttempts = reservedDoc.attempts.filter(
      (attempt) =>
        !(
          attempt.attemptNo === params.attemptNo &&
          attempt.status === "SCORING"
        ),
    );

    if (nextAttempts.length === reservedDoc.attempts.length) {
      return;
    }

    const nextAttemptsUsed = Math.max(0, reservedDoc.attemptsUsed - 1);
    if (nextAttemptsUsed === 0 && nextAttempts.length === 0) {
      delete roundAttempts[params.uid];
      if (Object.keys(roundAttempts).length === 0) {
        delete state.attempts[params.roundId];
      }
    } else {
      roundAttempts[params.uid] = {
        ...reservedDoc,
        attemptsUsed: nextAttemptsUsed,
        attempts: nextAttempts,
        updatedAt: new Date(),
      };
    }

    await saveRoomState(bumpRoomVersion(state));
  });
}

async function finalizeReservedAttempt(params: {
  roomId: string;
  roundId: string;
  uid: string;
  prompt: string;
  submitStartedAt: Date;
  reservedAttempt: ReservedAttempt;
  score: number;
  imageUrl: string;
  matchedElements: string[];
  missingElements: string[];
  judgeNote: string;
}): Promise<SubmitResponse> {
  return withRoomLock(params.roomId, async () => {
    const state = await loadRoomState(params.roomId);
    const currentRoom = state?.room;
    const currentRound = state?.rounds[params.roundId];
    const currentPlayer = state?.players[params.uid];

    if (!state || !currentRoom || !currentRound || !currentPlayer) {
      throw new AppError("INTERNAL_ERROR", "Failed to update round documents", true, 500);
    }

    assertRoundSubmissionWindow({
      room: currentRoom,
      round: currentRound,
      roundId: params.roundId,
      now: params.submitStartedAt,
      allowResults: true,
    });

    const endsAt = parseDate(currentRound.endsAt);
    const roundAttempts = state.attempts[params.roundId] ?? {};
    const reservedDoc = roundAttempts[params.uid];

    if (!reservedDoc) {
      throw new AppError("INTERNAL_ERROR", "Reserved attempt was not found", true, 500);
    }

    const reservedAttempt = reservedDoc.attempts.find(
      (attempt) => attempt.attemptNo === params.reservedAttempt.attemptNo,
    );
    if (!reservedAttempt || reservedAttempt.status !== "SCORING") {
      throw new AppError("INTERNAL_ERROR", "Reserved attempt is no longer pending", true, 500);
    }

    const createdAt = new Date();
    const prevBest = reservedDoc.bestScore ?? 0;
    const nextBest = Math.max(prevBest, params.score);
    const nextBestAttemptNo =
      params.score >= prevBest
        ? params.reservedAttempt.attemptNo
        : reservedDoc.bestAttemptNo ?? null;

    state.attempts[params.roundId] = {
      ...roundAttempts,
      [params.uid]: {
        ...reservedDoc,
        expiresAt: dateAfterHours(24),
        attemptsUsed: Math.max(
          reservedDoc.attemptsUsed,
          params.reservedAttempt.attemptNo,
        ),
        bestScore: nextBest,
        bestAttemptNo: nextBestAttemptNo,
        attempts: reservedDoc.attempts.map((attempt) =>
          attempt.attemptNo === params.reservedAttempt.attemptNo
            ? {
                ...attempt,
                prompt: params.prompt,
                imageUrl: params.imageUrl,
                score: params.score,
                matchedElements: params.matchedElements,
                missingElements: params.missingElements,
                judgeNote: params.judgeNote,
                status: "DONE",
                createdAt: reservedAttempt.createdAt ?? params.reservedAttempt.createdAt,
              }
            : attempt,
        ),
        updatedAt: createdAt,
      },
    };

    const roundScores = state.scores[params.roundId] ?? {};
    const previousScore = roundScores[params.uid];
    const scoredPlayersBefore = Object.keys(roundScores).length;
    const scoredPlayersAfter = scoredPlayersBefore + (previousScore ? 0 : 1);

    if (!previousScore || params.score >= previousScore.bestScore) {
      state.scores[params.roundId] = {
        ...roundScores,
        [params.uid]: {
          uid: params.uid,
          displayName: currentPlayer.displayName,
          bestScore: params.score,
          bestImageUrl: params.imageUrl,
          bestPromptPublic: params.prompt,
          updatedAt: createdAt,
          expiresAt: dateAfterHours(24),
        },
      };
    }

    currentRound.stats.submissions = (currentRound.stats.submissions ?? 0) + 1;
    currentRound.stats.topScore = Math.max(
      currentRound.stats.topScore ?? 0,
      params.score,
    );

    const totalPlayers = Object.keys(state.players).length;
    if (totalPlayers > 0 && scoredPlayersAfter >= totalPlayers) {
      const autoEndAt = new Date(
        createdAt.getTime() + RESULTS_GRACE_SECONDS * 1000,
      );
      if (!endsAt || endsAt.getTime() > autoEndAt.getTime()) {
        currentRound.endsAt = autoEndAt;
      }
    }

    if (nextBest > prevBest) {
      currentPlayer.totalScore = Math.max(
        0,
        (currentPlayer.totalScore ?? 0) - prevBest + nextBest,
      );
    }

    await saveRoomState(bumpRoomVersion(state));

    return {
      attemptNo: params.reservedAttempt.attemptNo,
      score: params.score,
      imageUrl: params.imageUrl,
      bestScore: nextBest,
      matchedElements: params.matchedElements,
      missingElements: params.missingElements,
      judgeNote: params.judgeNote,
    };
  });
}

export const POST = withPostHandler(submitSchema, async ({ body, auth, request }) => {
  const currentState = await loadRoomState(body.roomId);
  const currentRoom = currentState?.room;
  const language = normalizeLanguage(
    request.cookies.get(LANGUAGE_COOKIE_NAME)?.value,
  );

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

  const submitStartedAt = new Date();
  const result = await withSubmitLock(
    body.roomId,
    body.roundId,
    auth.uid,
    async (): Promise<SubmitResponse> => {
      const reservedAttempt = await reserveRoundAttempt({
        roomId: body.roomId,
        roundId: body.roundId,
        uid: auth.uid,
        prompt: body.prompt,
        submitStartedAt,
      });

      try {
        let generatedImage: GeneratedImage;
        try {
          generatedImage = await generateImage({
            prompt: body.prompt,
            aspectRatio: reservedAttempt.aspectRatio,
          });
        } catch (error) {
          logSubmitStageFailure(
            "image_generation",
            {
              roomId: body.roomId,
              roundId: body.roundId,
              uid: auth.uid,
              prompt: body.prompt,
              language,
            },
            error,
          );
          throw error;
        }

        const transientImageUrl =
          imageToPublicUrl(generatedImage, body.prompt) ?? undefined;

        let targetImageForJudge: GeneratedImage | null;
        let attemptImageForJudge: GeneratedImage | null;
        try {
          [targetImageForJudge, attemptImageForJudge] = await Promise.all([
            imageForVisualScoring(
              {
                mimeType: "image/png",
                directUrl: reservedAttempt.targetImageUrl,
              },
              reservedAttempt.targetImageUrl,
            ),
            imageForVisualScoring(generatedImage, transientImageUrl),
          ]);

          if (!targetImageForJudge?.base64Data || !attemptImageForJudge?.base64Data) {
            throw new AppError(
              "GEMINI_ERROR",
              "Failed to prepare images for visual scoring",
              true,
              502,
            );
          }
        } catch (error) {
          logSubmitStageFailure(
            "judge_prep",
            {
              roomId: body.roomId,
              roundId: body.roundId,
              uid: auth.uid,
              prompt: body.prompt,
              language,
            },
            error,
          );
          throw error;
        }

        let judged: Awaited<ReturnType<typeof scoreImageSimilarity>>;
        try {
          judged = await scoreImageSimilarity({
            targetImage: targetImageForJudge,
            attemptImage: attemptImageForJudge,
            language,
          });
        } catch (error) {
          logSubmitStageFailure(
            "visual_scoring",
            {
              roomId: body.roomId,
              roundId: body.roundId,
              uid: auth.uid,
              prompt: body.prompt,
              language,
            },
            error,
          );
          throw error;
        }

        const score = judged.score;
        const matchedElements = judged.matchedElements ?? [];
        const missingElements = judged.missingElements ?? [];
        const judgeNote = judged.note || fallbackJudgeNote(language);
        let imageUrl: string;
        try {
          imageUrl = await resolveBestImageUrl({
            roomId: body.roomId,
            roundId: body.roundId,
            uid: auth.uid,
            prompt: body.prompt,
            image: generatedImage,
          });
        } catch (error) {
          logSubmitStageFailure(
            "storage_upload",
            {
              roomId: body.roomId,
              roundId: body.roundId,
              uid: auth.uid,
              prompt: body.prompt,
              language,
            },
            error,
          );
          throw error;
        }

        return finalizeReservedAttempt({
          roomId: body.roomId,
          roundId: body.roundId,
          uid: auth.uid,
          prompt: body.prompt,
          submitStartedAt,
          reservedAttempt,
          score,
          imageUrl,
          matchedElements,
          missingElements,
          judgeNote,
        });
      } catch (error) {
        try {
          await rollbackReservedAttempt({
            roomId: body.roomId,
            roundId: body.roundId,
            uid: auth.uid,
            attemptNo: reservedAttempt.attemptNo,
          });
        } catch (rollbackError) {
          console.error("Failed to rollback reserved attempt", rollbackError);
        }

        throw error;
      }
    },
  );

  return ok(result);
});
