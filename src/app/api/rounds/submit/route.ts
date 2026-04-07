import { submitSchema } from "@/lib/api/schemas";
import { withPostHandler, ok } from "@/lib/api/handler";
import {
  assertRoundOpen,
  assertRoundSubmissionWindow,
} from "@/lib/game/round-validation";
import {
  generateImage,
  imageToBuffer,
  imageToPublicUrl,
  scoreImageSimilarity,
  type GeneratedImage,
} from "@/lib/gemini/client";
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
      throw new AppError("GEMINI_ERROR", "Failed to resolve generated image URL", true, 502);
    }
    return directUrl;
  }
}

export async function rollbackReservedAttempt() {
  return;
}

export const POST = withPostHandler(submitSchema, async ({ body, auth }) => {
  const submitStartedAt = new Date();
  const result = await withSubmitLock(
    body.roomId,
    body.roundId,
    auth.uid,
    async (): Promise<SubmitResponse> => {
      const { room, round, player } = await assertRoundOpen({
        roomId: body.roomId,
        roundId: body.roundId,
        uid: auth.uid,
        now: submitStartedAt,
      });

      const existingAttempt = (await loadRoomState(body.roomId))?.attempts[body.roundId]?.[auth.uid];
      if ((existingAttempt?.attemptsUsed ?? 0) >= room.settings.maxAttempts) {
        throw new AppError("MAX_ATTEMPTS_REACHED", "No attempts left", false, 409);
      }

      const generatedImage = await generateImage({
        prompt: body.prompt,
        aspectRatio: room.settings.aspectRatio,
      });

      const transientImageUrl = imageToPublicUrl(generatedImage, body.prompt) ?? undefined;

      const [targetImageForJudge, attemptImageForJudge] = await Promise.all([
        imageForVisualScoring({ mimeType: "image/png", directUrl: round.targetImageUrl }, round.targetImageUrl),
        imageForVisualScoring(generatedImage, transientImageUrl),
      ]);

      if (!targetImageForJudge?.base64Data || !attemptImageForJudge?.base64Data) {
        throw new AppError("GEMINI_ERROR", "Failed to prepare images for visual scoring", true, 502);
      }

      const judged = await scoreImageSimilarity({
        targetImage: targetImageForJudge,
        attemptImage: attemptImageForJudge,
      });

      const score = judged.score;
      const matchedElements = judged.matchedElements ?? [];
      const missingElements = judged.missingElements ?? [];
      const judgeNote = judged.note || "画像の見た目比較で採点";
      const imageUrl = await resolveBestImageUrl({
        roomId: body.roomId,
        roundId: body.roundId,
        uid: auth.uid,
        prompt: body.prompt,
        image: generatedImage,
      });

      return withRoomLock(body.roomId, async () => {
        const state = await loadRoomState(body.roomId);
        const currentRoom = state?.room;
        const currentRound = state?.rounds[body.roundId];
        const currentPlayer = state?.players[auth.uid];

        if (!state || !currentRoom || !currentRound || !currentPlayer) {
          throw new AppError("INTERNAL_ERROR", "Failed to update round documents", true, 500);
        }

        assertRoundSubmissionWindow({
          room: currentRoom,
          round: currentRound,
          roundId: body.roundId,
          now: submitStartedAt,
          allowResults: true,
        });

        const endsAt = parseDate(currentRound.endsAt);

        const roundAttempts = state.attempts[body.roundId] ?? {};
        const priorAttempts = roundAttempts[auth.uid];
        if ((priorAttempts?.attemptsUsed ?? 0) >= currentRoom.settings.maxAttempts) {
          throw new AppError("MAX_ATTEMPTS_REACHED", "No attempts left", false, 409);
        }

        const createdAt = new Date();
        const attemptNo = (priorAttempts?.attemptsUsed ?? 0) + 1;
        const prevBest = priorAttempts?.bestScore ?? 0;
        const nextBest = Math.max(prevBest, score);
        const nextBestAttemptNo = score >= prevBest ? attemptNo : priorAttempts?.bestAttemptNo ?? null;

        state.attempts[body.roundId] = {
          ...roundAttempts,
          [auth.uid]: {
            uid: auth.uid,
            roundId: body.roundId,
            expiresAt: dateAfterHours(24),
            attemptsUsed: attemptNo,
            hintUsed: 0,
            bestScore: nextBest,
            bestAttemptNo: nextBestAttemptNo,
            attempts: [
              {
                attemptNo,
                prompt: body.prompt,
                imageUrl,
                score,
                matchedElements,
                missingElements,
                judgeNote,
                status: "DONE",
                createdAt,
              },
            ],
            updatedAt: createdAt,
          },
        };

        const roundScores = state.scores[body.roundId] ?? {};
        const previousScore = roundScores[auth.uid];
        const scoredPlayersBefore = Object.keys(roundScores).length;
        const scoredPlayersAfter = scoredPlayersBefore + (previousScore ? 0 : 1);

        if (!previousScore || score >= previousScore.bestScore) {
          state.scores[body.roundId] = {
            ...roundScores,
            [auth.uid]: {
              uid: auth.uid,
              displayName: player.displayName,
              bestScore: score,
              bestImageUrl: imageUrl,
              bestPromptPublic: body.prompt,
              updatedAt: createdAt,
              expiresAt: dateAfterHours(24),
            },
          };
        }

        currentRound.stats.submissions = (currentRound.stats.submissions ?? 0) + 1;
        currentRound.stats.topScore = Math.max(currentRound.stats.topScore ?? 0, score);

        const totalPlayers = Object.keys(state.players).length;
        if (totalPlayers > 0 && scoredPlayersAfter >= totalPlayers) {
          const autoEndAt = new Date(createdAt.getTime() + 10_000);
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
          attemptNo,
          score,
          imageUrl,
          bestScore: nextBest,
          matchedElements,
          missingElements,
          judgeNote,
        };
      });
    },
  );

  return ok(result);
});
