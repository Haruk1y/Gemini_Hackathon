import {
  fallbackJudgeNote,
  scoreImageSimilarity,
} from "@/lib/gemini/client";
import {
  getRoundSubmissionDeadline,
  RESULTS_GRACE_SECONDS,
} from "@/lib/game/modes";
import {
  generateImage,
  imageToBuffer,
  imageToPublicUrl,
  type GeneratedImage,
} from "@/lib/images";
import { assertRoundSubmissionWindow } from "@/lib/game/round-validation";
import type { Language } from "@/lib/i18n/language";
import {
  bumpRoomVersion,
  loadRoomState,
  saveRoomState,
  type RoomState,
  withRoomLock,
  withSubmitLock,
} from "@/lib/server/room-state";
import { buildPlayerBestImagePath } from "@/lib/storage/paths";
import { uploadImageToStorage } from "@/lib/storage/upload-image";
import type {
  ImageModel,
  RoomDoc,
  RoundPublicDoc,
  TextModelVariant,
} from "@/lib/types/game";
import { AppError } from "@/lib/utils/errors";
import { dateAfterHours, parseDate } from "@/lib/utils/time";

export type ClassicSubmitStage =
  | "image_generation"
  | "judge_prep"
  | "visual_scoring"
  | "storage_upload";

export type ClassicSubmitMode = "normal" | "timeout";

export interface ClassicSubmitLogContext {
  roomId: string;
  roundId: string;
  uid: string;
  prompt: string;
  language: string;
}

export type ClassicSubmitStageLogger = (
  stage: ClassicSubmitStage,
  context: ClassicSubmitLogContext,
  error: unknown,
) => void;

export interface ClassicRoundSubmitResult extends Record<string, unknown> {
  attemptNo: number;
  score: number;
  imageUrl: string;
  bestScore: number;
  matchedElements: string[];
  missingElements: string[];
  judgeNote: string;
}

export interface ReservedClassicAttempt {
  attemptNo: number;
  createdAt: Date;
  aspectRatio: "1:1" | "16:9" | "9:16";
  imageModel: ImageModel;
  judgeModel: TextModelVariant;
  targetImageUrl: string;
}

function assertTimeoutReservationWindow(params: {
  room: Pick<RoomDoc, "status" | "currentRoundId" | "settings">;
  round: Pick<RoundPublicDoc, "status" | "endsAt" | "promptStartsAt">;
  roundId: string;
  now: Date;
}) {
  if (params.room.status !== "IN_ROUND") {
    throw new AppError("ROUND_CLOSED", "Room is not in round state", false, 409);
  }

  if (params.room.currentRoundId !== params.roundId) {
    throw new AppError("ROUND_CLOSED", "This round is not active", false, 409);
  }

  if (params.round.status !== "IN_ROUND") {
    throw new AppError("ROUND_CLOSED", "Round is not active", false, 409);
  }

  const promptStartsAt = parseDate(params.round.promptStartsAt);
  if (promptStartsAt && params.now.getTime() < promptStartsAt.getTime()) {
    throw new AppError("ROUND_CLOSED", "まだプロンプト入力開始前です。", false, 409);
  }

  const submissionDeadline =
    getRoundSubmissionDeadline({
      promptStartsAt: params.round.promptStartsAt,
      roundSeconds: params.room.settings.roundSeconds,
    }) ?? parseDate(params.round.endsAt);

  if (
    !submissionDeadline ||
    params.now.getTime() < submissionDeadline.getTime()
  ) {
    throw new AppError("ROUND_CLOSED", "Round timeout has not started", false, 409);
  }
}

function assertClassicReservationWindow(params: {
  room: Pick<RoomDoc, "status" | "currentRoundId" | "settings">;
  round: Pick<RoundPublicDoc, "status" | "endsAt" | "promptStartsAt">;
  roundId: string;
  now: Date;
  mode: ClassicSubmitMode;
}) {
  if (params.mode === "timeout") {
    assertTimeoutReservationWindow(params);
    return;
  }

  assertRoundSubmissionWindow({
    room: params.room,
    round: params.round,
    roundId: params.roundId,
    now: params.now,
  });
}

function assertClassicFinalizeWindow(params: {
  room: Pick<RoomDoc, "status" | "currentRoundId">;
  round: Pick<RoundPublicDoc, "status" | "endsAt" | "promptStartsAt">;
  roundId: string;
  submitStartedAt: Date;
  mode: ClassicSubmitMode;
}) {
  if (params.mode === "timeout") {
    const allowedStatuses = ["IN_ROUND", "RESULTS"];

    if (!allowedStatuses.includes(params.room.status)) {
      throw new AppError("ROUND_CLOSED", "Room is not in round state", false, 409);
    }

    if (params.room.currentRoundId !== params.roundId) {
      throw new AppError("ROUND_CLOSED", "This round is not active", false, 409);
    }

    if (!allowedStatuses.includes(params.round.status)) {
      throw new AppError("ROUND_CLOSED", "Round is not active", false, 409);
    }

    const promptStartsAt = parseDate(params.round.promptStartsAt);
    if (
      promptStartsAt &&
      params.submitStartedAt.getTime() < promptStartsAt.getTime()
    ) {
      throw new AppError("ROUND_CLOSED", "まだプロンプト入力開始前です。", false, 409);
    }

    return;
  }

  assertRoundSubmissionWindow({
    room: params.room,
    round: params.round,
    roundId: params.roundId,
    now: params.submitStartedAt,
    allowResults: true,
  });
}

async function fetchImageBytes(url: string): Promise<GeneratedImage | null> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    const mimeType =
      response.headers.get("content-type")?.split(";")[0] ?? "image/png";
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
  const directUrl = imageToPublicUrl(params.image);
  const imageBuffer = imageToBuffer(params.image);

  if (!imageBuffer || !params.image.base64Data) {
    if (!directUrl) {
      throw new AppError(
        "GEMINI_ERROR",
        "Failed to resolve generated image URL",
        true,
        502,
      );
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
    console.warn(
      "Best image storage upload fallback",
      params.roomId,
      params.roundId,
      error,
    );
    if (!directUrl) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        "GEMINI_ERROR",
        "Failed to resolve generated image URL",
        true,
        502,
      );
    }
    return directUrl;
  }
}

export function reserveClassicRoundAttemptInState(params: {
  state: RoomState;
  roomId: string;
  roundId: string;
  uid: string;
  prompt: string;
  submitStartedAt: Date;
  mode: ClassicSubmitMode;
}): ReservedClassicAttempt {
  const room = params.state.room;
  const round = params.state.rounds[params.roundId];

  if (!room || !round || !params.state.players[params.uid]) {
    throw new AppError("INTERNAL_ERROR", "Failed to reserve round attempt", true, 500);
  }

  assertClassicReservationWindow({
    room,
    round,
    roundId: params.roundId,
    now: params.submitStartedAt,
    mode: params.mode,
  });

  const roundAttempts = params.state.attempts[params.roundId] ?? {};
  const priorAttempts = roundAttempts[params.uid];
  if ((priorAttempts?.attemptsUsed ?? 0) >= room.settings.maxAttempts) {
    throw new AppError("MAX_ATTEMPTS_REACHED", "No attempts left", false, 409);
  }

  const attemptNo = (priorAttempts?.attemptsUsed ?? 0) + 1;
  const createdAt = new Date();

  params.state.attempts[params.roundId] = {
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
          status: "GENERATING",
          createdAt,
        },
      ],
      updatedAt: createdAt,
    },
  };

  return {
    attemptNo,
    createdAt,
    aspectRatio: room.settings.aspectRatio,
    imageModel: room.settings.imageModel,
    judgeModel: room.settings.judgeModel,
    targetImageUrl: round.targetImageUrl,
  };
}

async function reserveClassicRoundAttempt(params: {
  roomId: string;
  roundId: string;
  uid: string;
  prompt: string;
  submitStartedAt: Date;
  mode: ClassicSubmitMode;
}): Promise<ReservedClassicAttempt> {
  return withRoomLock(params.roomId, async () => {
    const state = await loadRoomState(params.roomId);
    if (!state) {
      throw new AppError("INTERNAL_ERROR", "Failed to reserve round attempt", true, 500);
    }

    const reservedAttempt = reserveClassicRoundAttemptInState({
      state,
      roomId: params.roomId,
      roundId: params.roundId,
      uid: params.uid,
      prompt: params.prompt,
      submitStartedAt: params.submitStartedAt,
      mode: params.mode,
    });

    await saveRoomState(bumpRoomVersion(state));
    return reservedAttempt;
  });
}

async function rollbackReservedAttempt(params: {
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
      (attempt) => !(attempt.attemptNo === params.attemptNo && attempt.status !== "DONE"),
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

async function markReservedAttemptScoring(params: {
  roomId: string;
  roundId: string;
  uid: string;
  prompt: string;
  submitStartedAt: Date;
  reservedAttempt: ReservedClassicAttempt;
  imageUrl: string;
  mode: ClassicSubmitMode;
}): Promise<void> {
  await withRoomLock(params.roomId, async () => {
    const state = await loadRoomState(params.roomId);
    const currentRoom = state?.room;
    const currentRound = state?.rounds[params.roundId];

    if (!state || !currentRoom || !currentRound) {
      throw new AppError(
        "INTERNAL_ERROR",
        "Failed to update reserved attempt progress",
        true,
        500,
      );
    }

    assertClassicFinalizeWindow({
      room: currentRoom,
      round: currentRound,
      roundId: params.roundId,
      submitStartedAt: params.submitStartedAt,
      mode: params.mode,
    });

    const roundAttempts = state.attempts[params.roundId] ?? {};
    const reservedDoc = roundAttempts[params.uid];
    if (!reservedDoc) {
      throw new AppError(
        "INTERNAL_ERROR",
        "Reserved attempt was not found",
        true,
        500,
      );
    }

    const reservedAttempt = reservedDoc.attempts.find(
      (attempt) => attempt.attemptNo === params.reservedAttempt.attemptNo,
    );
    if (!reservedAttempt || reservedAttempt.status !== "GENERATING") {
      throw new AppError(
        "INTERNAL_ERROR",
        "Reserved attempt is no longer generating",
        true,
        500,
      );
    }

    state.attempts[params.roundId] = {
      ...roundAttempts,
      [params.uid]: {
        ...reservedDoc,
        attempts: reservedDoc.attempts.map((attempt) =>
          attempt.attemptNo === params.reservedAttempt.attemptNo
            ? {
                ...attempt,
                prompt: params.prompt,
                imageUrl: params.imageUrl,
                status: "SCORING",
              }
            : attempt,
        ),
        updatedAt: new Date(),
      },
    };

    await saveRoomState(bumpRoomVersion(state));
  });
}

async function finalizeReservedAttempt(params: {
  roomId: string;
  roundId: string;
  uid: string;
  prompt: string;
  submitStartedAt: Date;
  reservedAttempt: ReservedClassicAttempt;
  score: number;
  imageUrl: string;
  matchedElements: string[];
  missingElements: string[];
  judgeNote: string;
  mode: ClassicSubmitMode;
}): Promise<ClassicRoundSubmitResult> {
  return withRoomLock(params.roomId, async () => {
    const state = await loadRoomState(params.roomId);
    const currentRoom = state?.room;
    const currentRound = state?.rounds[params.roundId];
    const currentPlayer = state?.players[params.uid];

    if (!state || !currentRoom || !currentRound || !currentPlayer) {
      throw new AppError(
        "INTERNAL_ERROR",
        "Failed to update round documents",
        true,
        500,
      );
    }

    assertClassicFinalizeWindow({
      room: currentRoom,
      round: currentRound,
      roundId: params.roundId,
      submitStartedAt: params.submitStartedAt,
      mode: params.mode,
    });

    const endsAt = parseDate(currentRound.endsAt);
    const roundAttempts = state.attempts[params.roundId] ?? {};
    const reservedDoc = roundAttempts[params.uid];

    if (!reservedDoc) {
      throw new AppError(
        "INTERNAL_ERROR",
        "Reserved attempt was not found",
        true,
        500,
      );
    }

    const reservedAttempt = reservedDoc.attempts.find(
      (attempt) => attempt.attemptNo === params.reservedAttempt.attemptNo,
    );
    if (!reservedAttempt || reservedAttempt.status !== "SCORING") {
      throw new AppError(
        "INTERNAL_ERROR",
        "Reserved attempt is no longer pending",
        true,
        500,
      );
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
                createdAt:
                  reservedAttempt.createdAt ?? params.reservedAttempt.createdAt,
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

export async function submitClassicRoundAttemptWithReservation(params: {
  roomId: string;
  roundId: string;
  uid: string;
  prompt: string;
  language: Language;
  submitStartedAt: Date;
  reservedAttempt: ReservedClassicAttempt;
  mode: ClassicSubmitMode;
  logStageFailure?: ClassicSubmitStageLogger;
}): Promise<ClassicRoundSubmitResult> {
  const context: ClassicSubmitLogContext = {
    roomId: params.roomId,
    roundId: params.roundId,
    uid: params.uid,
    prompt: params.prompt,
    language: params.language,
  };

  try {
    let generatedImage: GeneratedImage;
    try {
      generatedImage = await generateImage({
        prompt: params.prompt,
        aspectRatio: params.reservedAttempt.aspectRatio,
        imageModel: params.reservedAttempt.imageModel,
      });
    } catch (error) {
      params.logStageFailure?.("image_generation", context, error);
      throw error;
    }

    const transientImageUrl = imageToPublicUrl(generatedImage) ?? undefined;

    let imageUrl: string;
    try {
      imageUrl = await resolveBestImageUrl({
        roomId: params.roomId,
        roundId: params.roundId,
        uid: params.uid,
        prompt: params.prompt,
        image: generatedImage,
      });
    } catch (error) {
      params.logStageFailure?.("storage_upload", context, error);
      throw error;
    }

    await markReservedAttemptScoring({
      roomId: params.roomId,
      roundId: params.roundId,
      uid: params.uid,
      prompt: params.prompt,
      submitStartedAt: params.submitStartedAt,
      reservedAttempt: params.reservedAttempt,
      imageUrl,
      mode: params.mode,
    });

    let targetImageForJudge: GeneratedImage | null;
    let attemptImageForJudge: GeneratedImage | null;
    try {
      [targetImageForJudge, attemptImageForJudge] = await Promise.all([
        imageForVisualScoring(
          {
            mimeType: "image/png",
            directUrl: params.reservedAttempt.targetImageUrl,
          },
          params.reservedAttempt.targetImageUrl,
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
      params.logStageFailure?.("judge_prep", context, error);
      throw error;
    }

    let judged: Awaited<ReturnType<typeof scoreImageSimilarity>>;
    try {
      judged = await scoreImageSimilarity({
        targetImage: targetImageForJudge,
        attemptImage: attemptImageForJudge,
        language: params.language,
        judgeModel: params.reservedAttempt.judgeModel,
      });
    } catch (error) {
      params.logStageFailure?.("visual_scoring", context, error);
      throw error;
    }

    const score = judged.score;
    const matchedElements = judged.matchedElements ?? [];
    const missingElements = judged.missingElements ?? [];
    const judgeNote = judged.note || fallbackJudgeNote(params.language);

    return await finalizeReservedAttempt({
      roomId: params.roomId,
      roundId: params.roundId,
      uid: params.uid,
      prompt: params.prompt,
      submitStartedAt: params.submitStartedAt,
      reservedAttempt: params.reservedAttempt,
      score,
      imageUrl,
      matchedElements,
      missingElements,
      judgeNote,
      mode: params.mode,
    });
  } catch (error) {
    try {
      await rollbackReservedAttempt({
        roomId: params.roomId,
        roundId: params.roundId,
        uid: params.uid,
        attemptNo: params.reservedAttempt.attemptNo,
      });
    } catch (rollbackError) {
      console.error("Failed to rollback reserved attempt", rollbackError);
    }

    throw error;
  }
}

export async function submitClassicRoundAttempt(params: {
  roomId: string;
  roundId: string;
  uid: string;
  prompt: string;
  language: Language;
  mode?: ClassicSubmitMode;
  logStageFailure?: ClassicSubmitStageLogger;
}): Promise<ClassicRoundSubmitResult> {
  const submitStartedAt = new Date();
  const mode = params.mode ?? "normal";

  return withSubmitLock(
    params.roomId,
    params.roundId,
    params.uid,
    async () => {
      const reservedAttempt = await reserveClassicRoundAttempt({
        roomId: params.roomId,
        roundId: params.roundId,
        uid: params.uid,
        prompt: params.prompt,
        submitStartedAt,
        mode,
      });

      return submitClassicRoundAttemptWithReservation({
        roomId: params.roomId,
        roundId: params.roundId,
        uid: params.uid,
        prompt: params.prompt,
        language: params.language,
        submitStartedAt,
        reservedAttempt,
        mode,
        logStageFailure: params.logStageFailure,
      });
    },
  );
}
