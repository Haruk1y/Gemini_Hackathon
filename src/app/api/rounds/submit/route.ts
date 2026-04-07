import { getAdminDb } from "@/lib/google-cloud/admin";
import { submitSchema } from "@/lib/api/schemas";
import { withPostHandler, ok } from "@/lib/api/handler";
import {
  attemptPrivateRef,
  playersRef,
  playerRef,
  roundRef,
  scoreRef,
  scoresRef,
} from "@/lib/api/paths";
import { assertRoundOpen } from "@/lib/game/round-validation";
import {
  captionFromImage,
  generateImage,
  imageToBuffer,
  imageToPublicUrl,
  scoreImageSimilarity,
  type GeneratedImage,
} from "@/lib/gemini/client";
import { normalizeCaption } from "@/lib/scoring/normalize-caption";
import { buildPlayerBestImagePath } from "@/lib/storage/paths";
import { uploadImageToStorage } from "@/lib/storage/upload-image";
import { AppError } from "@/lib/utils/errors";
import { dateAfterHours, parseDate } from "@/lib/utils/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AttemptDocShape {
  attemptsUsed: number;
  hintUsed: number;
  bestScore: number;
  bestAttemptNo: number | null;
  attempts: Array<{
    attemptNo: number;
    prompt: string;
    imageUrl: string;
    captionText?: string;
    score: number | null;
    status?: "SCORING" | "DONE";
    matchedElements?: string[];
    missingElements?: string[];
    judgeNote?: string;
    createdAt: Date;
  }>;
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
    if (/cannot sign data without `?client_email`?/i.test(String(error))) {
      throw new AppError(
        "GCP_ERROR",
        "Cloud Storage の署名付きURLを作れません。ローカル/Vercel では `GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY_JSON` を設定してください。",
        false,
        503,
      );
    }
    if (!directUrl) {
      throw new AppError("GEMINI_ERROR", "Failed to resolve generated image URL", true, 502);
    }
    return directUrl;
  }
}

async function reserveAttempt(params: {
  roomId: string;
  roundId: string;
  uid: string;
  maxAttempts: number;
}): Promise<{ attemptNo: number; createdDoc: boolean }> {
  const attemptRef = attemptPrivateRef(params.roomId, params.roundId, params.uid);

  return getAdminDb().runTransaction(async (tx) => {
    const snapshot = await tx.get(attemptRef);
    const now = new Date();

    if (!snapshot.exists) {
      tx.set(attemptRef, {
        uid: params.uid,
        roundId: params.roundId,
        expiresAt: dateAfterHours(24),
        attemptsUsed: 1,
        hintUsed: 0,
        bestScore: 0,
        bestAttemptNo: null,
        attempts: [],
        updatedAt: now,
      });

      return { attemptNo: 1, createdDoc: true };
    }

    const data = snapshot.data() as { attemptsUsed: number };
    if (data.attemptsUsed >= params.maxAttempts) {
      throw new AppError("MAX_ATTEMPTS_REACHED", "No attempts left", false, 409);
    }

    const attemptNo = data.attemptsUsed + 1;
    tx.update(attemptRef, {
      attemptsUsed: attemptNo,
      updatedAt: now,
    });

    return { attemptNo, createdDoc: false };
  });
}

export async function rollbackReservedAttempt(params: {
  roomId: string;
  roundId: string;
  uid: string;
  attemptNo: number;
  createdDoc: boolean;
}) {
  const attemptRef = attemptPrivateRef(params.roomId, params.roundId, params.uid);

  await getAdminDb().runTransaction(async (tx) => {
    const snapshot = await tx.get(attemptRef);
    if (!snapshot.exists) return;

    if (params.createdDoc) {
      tx.delete(attemptRef);
      return;
    }

    const data = snapshot.data() as AttemptDocShape;
    const nextAttempts = (data.attempts ?? []).filter(
      (attempt) => attempt.attemptNo !== params.attemptNo,
    );

    tx.update(attemptRef, {
      attemptsUsed: Math.max(0, (data.attemptsUsed ?? 1) - 1),
      attempts: nextAttempts,
      updatedAt: new Date(),
    });
  });
}

export const POST = withPostHandler(submitSchema, async ({ body, auth }) => {
  const { room, round, player } = await assertRoundOpen({
    roomId: body.roomId,
    roundId: body.roundId,
    uid: auth.uid,
  });

  const reservation = await reserveAttempt({
    roomId: body.roomId,
    roundId: body.roundId,
    uid: auth.uid,
    maxAttempts: room.settings.maxAttempts,
  });

  try {
    const generatedImage = await generateImage({
      prompt: body.prompt,
      aspectRatio: room.settings.aspectRatio,
    });

    const createdAt = new Date();
    const transientImageUrl = imageToPublicUrl(generatedImage, body.prompt) ?? undefined;

    const captionJson = await captionFromImage(generatedImage, body.prompt);
    const captionText = normalizeCaption(captionJson);

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

    const scoreDocRef = scoreRef(body.roomId, body.roundId, auth.uid);
    const playerDocRef = playerRef(body.roomId, auth.uid);
    const currentRoundRef = roundRef(body.roomId, body.roundId);
    const attemptRef = attemptPrivateRef(body.roomId, body.roundId, auth.uid);

    const result = await getAdminDb().runTransaction(async (tx) => {
      const [attemptSnapshot, scoreSnapshot, playerSnapshot, roundSnapshot, playersSnapshot, scoresSnapshot] =
        await Promise.all([
          tx.get(attemptRef),
          tx.get(scoreDocRef),
          tx.get(playerDocRef),
          tx.get(currentRoundRef),
          tx.get(playersRef(body.roomId)),
          tx.get(scoresRef(body.roomId, body.roundId)),
        ]);

      if (!attemptSnapshot.exists || !playerSnapshot.exists || !roundSnapshot.exists) {
        throw new AppError("INTERNAL_ERROR", "Failed to update round documents", true, 500);
      }

      const attemptData = attemptSnapshot.data() as AttemptDocShape;
      const prevBest = attemptData.bestScore ?? 0;
      const nextBest = Math.max(prevBest, score);
      const nextBestAttemptNo =
        score >= prevBest ? reservation.attemptNo : attemptData.bestAttemptNo;

      let finalized = false;
      const nextAttempts = (attemptData.attempts ?? []).map((attempt) => {
        if (attempt.attemptNo !== reservation.attemptNo) {
          return attempt;
        }

        finalized = true;
        return {
          ...attempt,
          prompt: body.prompt,
          imageUrl,
          captionText,
          score,
          matchedElements,
          missingElements,
          judgeNote,
          status: "DONE" as const,
          createdAt,
        };
      });

      if (!finalized) {
        nextAttempts.push({
          attemptNo: reservation.attemptNo,
          prompt: body.prompt,
          imageUrl,
          captionText,
          score,
          matchedElements,
          missingElements,
          judgeNote,
          status: "DONE" as const,
          createdAt,
        });
      }

      tx.update(attemptRef, {
        attempts: nextAttempts,
        bestScore: nextBest,
        bestAttemptNo: nextBestAttemptNo,
        updatedAt: createdAt,
      });

      const roundData = roundSnapshot.data() as {
        stats?: { submissions?: number; topScore?: number };
        endsAt?: unknown;
      };

      tx.update(currentRoundRef, {
        "stats.submissions": (roundData.stats?.submissions ?? 0) + 1,
        "stats.topScore": Math.max(roundData.stats?.topScore ?? 0, score),
      });

      const totalPlayers = playersSnapshot.size;
      const scoredPlayersBefore = scoresSnapshot.size;
      const scoredPlayersAfter = scoredPlayersBefore + (scoreSnapshot.exists ? 0 : 1);
      if (totalPlayers > 0 && scoredPlayersAfter >= totalPlayers) {
        const autoEndAt = new Date(createdAt.getTime() + 10_000);
        const roundEndsAt = parseDate(roundData.endsAt);
        if (!roundEndsAt || roundEndsAt.getTime() > autoEndAt.getTime()) {
          tx.update(currentRoundRef, {
            endsAt: autoEndAt,
          });
        }
      }

      if (!scoreSnapshot.exists) {
        tx.set(scoreDocRef, {
          uid: auth.uid,
          displayName: player.displayName,
          bestScore: score,
          bestImageUrl: imageUrl,
          bestPromptPublic: body.prompt,
          updatedAt: createdAt,
          expiresAt: dateAfterHours(24),
        });
      } else {
        const scoreData = scoreSnapshot.data() as { bestScore: number };
        if (score >= (scoreData.bestScore ?? 0)) {
          tx.update(scoreDocRef, {
            bestScore: score,
            bestImageUrl: imageUrl,
            bestPromptPublic: body.prompt,
            updatedAt: createdAt,
          });
        }
      }

      const playerData = playerSnapshot.data() as { totalScore: number };
      if (nextBest > prevBest) {
        tx.update(playerDocRef, {
          totalScore: Math.max(0, (playerData.totalScore ?? 0) - prevBest + nextBest),
        });
      }

      return {
        bestScore: nextBest,
      };
    });

    return ok({
      attemptNo: reservation.attemptNo,
      score,
      imageUrl,
      bestScore: result.bestScore,
      matchedElements,
      missingElements,
      judgeNote,
    });
  } catch (error) {
    console.error("submit attempt failed", {
      roomId: body.roomId,
      roundId: body.roundId,
      uid: auth.uid,
      error,
    });

    try {
      await rollbackReservedAttempt({
        roomId: body.roomId,
        roundId: body.roundId,
        uid: auth.uid,
        attemptNo: reservation.attemptNo,
        createdDoc: reservation.createdDoc,
      });
    } catch (rollbackError) {
      console.error("submit rollback failed", rollbackError);
    }

    throw error;
  }
});
