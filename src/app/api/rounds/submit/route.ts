import { getAdminDb } from "@/lib/firebase/admin";
import { submitSchema } from "@/lib/api/schemas";
import { withPostHandler, ok } from "@/lib/api/handler";
import {
  attemptPrivateRef,
  scoreRef,
  playerRef,
  roundRef,
} from "@/lib/api/paths";
import { assertRoundOpen } from "@/lib/game/round-validation";
import {
  captionFromImage,
  embedText,
  generateImage,
  imageToBuffer,
  imageToPublicUrl,
  scoreImageSimilarity,
  type GeneratedImage,
} from "@/lib/gemini/client";
import { cosineSimilarity, cosineToScore } from "@/lib/scoring/cosine";
import { normalizeCaption } from "@/lib/scoring/normalize-caption";
import { uploadImageToStorage } from "@/lib/storage/upload-image";
import { AppError } from "@/lib/utils/errors";
import { dateAfterHours } from "@/lib/utils/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export const POST = withPostHandler(submitSchema, async ({ body, auth }) => {
  const { room, round, player, roundPrivate } = await assertRoundOpen({
    roomId: body.roomId,
    roundId: body.roundId,
    uid: auth.uid,
  });

  const attemptRef = attemptPrivateRef(body.roomId, body.roundId, auth.uid);

  const reservation = await getAdminDb().runTransaction(async (tx) => {
    const snapshot = await tx.get(attemptRef);
    const now = new Date();

    if (!snapshot.exists) {
      tx.set(attemptRef, {
        uid: auth.uid,
        roundId: body.roundId,
        expiresAt: dateAfterHours(24),
        attemptsUsed: 1,
        hintUsed: 0,
        bestScore: 0,
        bestAttemptNo: null,
        attempts: [],
        updatedAt: now,
      });

      return { attemptNo: 1 };
    }

    const data = snapshot.data() as {
      attemptsUsed: number;
    };

    if (data.attemptsUsed >= room.settings.maxAttempts) {
      throw new AppError("MAX_ATTEMPTS_REACHED", "No attempts left", false, 409);
    }

    const attemptNo = data.attemptsUsed + 1;
    tx.update(attemptRef, {
      attemptsUsed: attemptNo,
      updatedAt: now,
    });

    return { attemptNo };
  });

  const generatedImage = await generateImage({
    prompt: body.prompt,
    aspectRatio: room.settings.aspectRatio,
  });

  const imageBuffer = imageToBuffer(generatedImage);
  let imageUrl = imageToPublicUrl(generatedImage, body.prompt);

  if (imageBuffer) {
    imageUrl = await uploadImageToStorage({
      path: `rooms/${body.roomId}/rounds/${body.roundId}/players/${auth.uid}/attempt-${reservation.attemptNo}.png`,
      buffer: imageBuffer,
      mimeType: generatedImage.mimeType,
    });
  }

  if (!imageUrl) {
    throw new AppError("GEMINI_ERROR", "Failed to resolve generated image URL", true, 502);
  }

  const createdAt = new Date();

  await getAdminDb().runTransaction(async (tx) => {
    const snapshot = await tx.get(attemptRef);
    if (!snapshot.exists) {
      throw new AppError("INTERNAL_ERROR", "Attempt document missing", true, 500);
    }

    const data = snapshot.data() as {
      attempts: Array<{
        attemptNo: number;
        prompt: string;
        imageUrl: string;
        score: number | null;
        status?: "SCORING" | "DONE";
        matchedElements?: string[];
        missingElements?: string[];
        judgeNote?: string;
        createdAt: Date;
      }>;
    };

    const pendingAttempt = {
      attemptNo: reservation.attemptNo,
      prompt: body.prompt,
      imageUrl,
      score: null,
      status: "SCORING" as const,
      createdAt,
    };

    const attempts = data.attempts ?? [];
    const existingIndex = attempts.findIndex((attempt) => attempt.attemptNo === reservation.attemptNo);
    const nextAttempts =
      existingIndex >= 0
        ? attempts.map((attempt, index) => (index === existingIndex ? pendingAttempt : attempt))
        : [...attempts, pendingAttempt];

    tx.update(attemptRef, {
      attempts: nextAttempts,
      updatedAt: createdAt,
    });
  });

  const captionJson = await captionFromImage(generatedImage, body.prompt);
  const captionText = normalizeCaption(captionJson);
  const embedding = await embedText(captionText);

  const similarity = cosineSimilarity(roundPrivate.targetEmbedding, embedding);
  const semanticScore = cosineToScore(similarity);
  let score = semanticScore;
  let visualScore: number | null = null;
  let scoreSource: "semantic" | "visual" = "semantic";
  let matchedElements: string[] = [];
  let missingElements: string[] = [];
  let judgeNote = "意味類似度をもとに採点";

  const [targetImageForJudge, attemptImageForJudge] = await Promise.all([
    imageForVisualScoring({ mimeType: "image/png", directUrl: round.targetImageUrl }, round.targetImageUrl),
    imageForVisualScoring(generatedImage, imageUrl),
  ]);

  if (targetImageForJudge?.base64Data && attemptImageForJudge?.base64Data) {
    const judged = await scoreImageSimilarity({
      targetImage: targetImageForJudge,
      attemptImage: attemptImageForJudge,
      promptHint: body.prompt,
    });

    if (judged.note !== "visual scoring fallback") {
      visualScore = judged.score;
      score = judged.score;
      scoreSource = "visual";
      matchedElements = judged.matchedElements ?? [];
      missingElements = judged.missingElements ?? [];
      judgeNote = judged.note || "画像の見た目比較で採点";
    }
  }

  const scoreDocRef = scoreRef(body.roomId, body.roundId, auth.uid);
  const playerDocRef = playerRef(body.roomId, auth.uid);
  const currentRoundRef = roundRef(body.roomId, body.roundId);

  const result = await getAdminDb().runTransaction(async (tx) => {
    const [attemptSnapshot, scoreSnapshot, playerSnapshot, roundSnapshot] =
      await Promise.all([
        tx.get(attemptRef),
        tx.get(scoreDocRef),
        tx.get(playerDocRef),
        tx.get(currentRoundRef),
      ]);

    if (!attemptSnapshot.exists || !playerSnapshot.exists || !roundSnapshot.exists) {
      throw new AppError("INTERNAL_ERROR", "Failed to update round documents", true, 500);
    }

    const attemptData = attemptSnapshot.data() as {
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
    };

    const prevBest = attemptData.bestScore ?? 0;
    const nextBest = Math.max(prevBest, score);
    const nextBestAttemptNo = score >= prevBest ? reservation.attemptNo : attemptData.bestAttemptNo;

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
        semanticScore,
        visualScore,
        scoreSource,
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
        semanticScore,
        visualScore,
        scoreSource,
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
      scoreSource,
      updatedAt: createdAt,
    });

    const roundData = roundSnapshot.data() as {
      stats?: { submissions?: number; topScore?: number };
    };

    tx.update(currentRoundRef, {
      "stats.submissions": (roundData.stats?.submissions ?? 0) + 1,
      "stats.topScore": Math.max(roundData.stats?.topScore ?? 0, score),
    });

    if (!scoreSnapshot.exists) {
      tx.set(scoreDocRef, {
        uid: auth.uid,
        displayName: player.displayName,
        bestScore: score,
        bestImageUrl: imageUrl,
        updatedAt: createdAt,
        expiresAt: dateAfterHours(24),
      });
    } else {
      const scoreData = scoreSnapshot.data() as {
        bestScore: number;
      };

      if (score >= (scoreData.bestScore ?? 0)) {
        tx.update(scoreDocRef, {
          bestScore: score,
          bestImageUrl: imageUrl,
          bestPromptPublic: body.prompt,
          updatedAt: createdAt,
        });
      }
    }

    const playerData = playerSnapshot.data() as {
      totalScore: number;
    };

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
    semanticScore,
    visualScore,
    scoreSource,
    matchedElements,
    missingElements,
    judgeNote,
  });
});
