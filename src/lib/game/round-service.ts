import {
  generateGmPrompt,
  generateImage,
  imageToBuffer,
  imageToPublicUrl,
} from "@/lib/gemini/client";
import { nextRoundId } from "@/lib/game/defaults";
import { requirePlayer, requireRoom } from "@/lib/game/guards";
import { getRoundSchedule } from "@/lib/game/modes";
import { assertCanStartRound } from "@/lib/game/room-service";
import { assertRoomTransition } from "@/lib/game/state-machine";
import {
  bumpRoomVersion,
  loadRoomState,
  saveRoomState,
  withRoomLock,
} from "@/lib/server/room-state";
import { buildRoundTargetImagePath } from "@/lib/storage/paths";
import { uploadImageToStorage } from "@/lib/storage/upload-image";
import type { RoundPublicDoc, RoomStatus } from "@/lib/types/game";
import { AppError } from "@/lib/utils/errors";
import { dateAfterHours, parseDate } from "@/lib/utils/time";

function describeRoundGenerationError(error: unknown): AppError {
  if (error instanceof AppError) {
    if (/BLOB_READ_WRITE_TOKEN is missing|Vercel Blob: No token found/i.test(error.message)) {
      return new AppError(
        "INTERNAL_ERROR",
        "画像保存の設定が不足しています。BLOB_READ_WRITE_TOKEN を設定して再デプロイしてください。",
        false,
        503,
      );
    }

    if (error.code === "ROUND_CLOSED" && /Round generation state was replaced/i.test(error.message)) {
      return new AppError(
        "ROUND_CLOSED",
        "お題生成中に状態が競合しました。もう一度お試しください。",
        false,
        409,
      );
    }

    if (error.code === "GEMINI_ERROR") {
      return new AppError(
        "GEMINI_ERROR",
        "お題画像の生成に失敗しました。Gemini の設定または利用状況を確認して再試行してください。",
        true,
        502,
      );
    }

    return error;
  }

  return new AppError(
    "GEMINI_ERROR",
    "お題画像の生成に失敗しました。しばらくしてから再試行してください。",
    true,
    502,
  );
}

async function resolveImageUrl(params: {
  roomId: string;
  roundId: string;
  subPath: string;
  prompt: string;
  image: Awaited<ReturnType<typeof generateImage>>;
}): Promise<string> {
  const directUrl = imageToPublicUrl(params.image, params.prompt);
  const buffer = imageToBuffer(params.image);

  if (!buffer || !params.image.base64Data) {
    if (!directUrl) {
      throw new AppError("GEMINI_ERROR", "No image output available", true, 502);
    }
    return directUrl;
  }

  try {
    return await uploadImageToStorage({
      path:
        params.subPath === "target.png"
          ? buildRoundTargetImagePath(params.roomId, params.roundId)
          : `rooms/${params.roomId}/rounds/${params.roundId}/${params.subPath}`,
      buffer,
      mimeType: params.image.mimeType,
    });
  } catch (error) {
    console.warn("Image storage upload fallback", params.roomId, params.roundId, error);
    if (!directUrl) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError("GEMINI_ERROR", "No fallback image URL available", true, 502);
    }
    return directUrl;
  }
}

export async function startRound(params: {
  roomId: string;
  uid: string;
}): Promise<{ roundId: string; roundIndex: number }> {
  const reservation = await withRoomLock(params.roomId, async () => {
    const state = await loadRoomState(params.roomId);
    const room = requireRoom(state?.room);
    const player = requirePlayer(state?.players[params.uid]);

    if (!player.isHost) {
      throw new AppError("NOT_HOST", "Only host can start rounds", false, 403);
    }

    if (!["LOBBY", "RESULTS"].includes(room.status)) {
      throw new AppError(
        "VALIDATION_ERROR",
        `Room status ${room.status} cannot start a round`,
        false,
        409,
      );
    }

    const players = Object.values(state!.players).map((candidate) => ({
      ready: Boolean(candidate.ready),
      lastSeenAt: parseDate(candidate.lastSeenAt),
    }));

    const nowMs = Date.now();
    const activePlayers = players.filter(
      (candidate) => !candidate.lastSeenAt || nowMs - candidate.lastSeenAt.getTime() <= 90_000,
    );
    assertCanStartRound(activePlayers.length > 0 ? activePlayers : players);

    const nextIndex = room.roundIndex + 1;
    if (nextIndex > room.settings.totalRounds) {
      room.status = "FINISHED";
      await saveRoomState(bumpRoomVersion(state!));
      throw new AppError("VALIDATION_ERROR", "All rounds are completed", false, 409);
    }

    const roundId = nextRoundId(nextIndex);
    const now = new Date();
    const expiresAt = dateAfterHours(24);
    const previousStatus = room.status;
    const previousRoundId = room.currentRoundId;
    const previousRoundIndex = room.roundIndex;

    assertRoomTransition(room.status, "GENERATING_ROUND");

    room.status = "GENERATING_ROUND";
    room.currentRoundId = roundId;
    room.roundIndex = nextIndex;

    const baseRoundDoc: RoundPublicDoc = {
      roundId,
      index: nextIndex,
      status: "GENERATING",
      createdAt: now,
      expiresAt,
      startedAt: null,
      promptStartsAt: null,
      endsAt: null,
      targetImageUrl: "",
      targetThumbUrl: "",
      gmTitle: "Generating...",
      gmTags: [],
      difficulty: 3,
      reveal: {},
      stats: {
        submissions: 0,
        topScore: 0,
      },
    };

    state!.rounds[roundId] = baseRoundDoc;
    state!.roundPrivates[roundId] = {
      roundId,
      createdAt: now,
      expiresAt,
      gmPrompt: "",
      gmNegativePrompt: "",
      safety: {
        blocked: false,
      },
    };

    await saveRoomState(bumpRoomVersion(state!));

    return {
      previousStatus: previousStatus as RoomStatus,
      previousRoundId,
      previousRoundIndex,
      roundId,
      roundIndex: nextIndex,
      settings: room.settings,
      expiresAt,
    };
  });

  const previousStatus = reservation.previousStatus;
  const previousRoundId = reservation.previousRoundId;
  const previousRoundIndex = reservation.previousRoundIndex;

  try {
    const gmPrompt = await generateGmPrompt({
      settings: reservation.settings,
    });
    const targetImage = await generateImage({
      prompt: gmPrompt.prompt,
      aspectRatio: reservation.settings.aspectRatio,
    });

    const targetImageUrl = await resolveImageUrl({
      roomId: params.roomId,
      roundId: reservation.roundId,
      subPath: "target.png",
      prompt: gmPrompt.prompt,
      image: targetImage,
    });

    await withRoomLock(params.roomId, async () => {
      const state = await loadRoomState(params.roomId);
      const room = requireRoom(state?.room);
      const round = state?.rounds[reservation.roundId];
      const roundPrivate = state?.roundPrivates[reservation.roundId];

      if (
        !round ||
        !roundPrivate ||
        room.status !== "GENERATING_ROUND" ||
        room.currentRoundId !== reservation.roundId
      ) {
        throw new AppError("ROUND_CLOSED", "Round generation state was replaced", false, 409);
      }

      const startedAt = new Date();
      const { promptStartsAt, endsAt } = getRoundSchedule({
        gameMode: room.settings.gameMode,
        roundSeconds: room.settings.roundSeconds,
        startedAt,
      });

      round.status = "IN_ROUND";
      round.startedAt = startedAt;
      round.promptStartsAt = promptStartsAt;
      round.endsAt = endsAt;
      round.targetImageUrl = targetImageUrl;
      round.targetThumbUrl = targetImageUrl;
      round.gmTitle = gmPrompt.title;
      round.gmTags = gmPrompt.tags;
      round.difficulty = gmPrompt.difficulty as RoundPublicDoc["difficulty"];
      round.reveal = {};

      roundPrivate.createdAt = startedAt;
      roundPrivate.expiresAt = reservation.expiresAt;
      roundPrivate.gmPrompt = gmPrompt.prompt;
      roundPrivate.gmNegativePrompt = gmPrompt.negativePrompt ?? "";

      assertRoomTransition("GENERATING_ROUND", "IN_ROUND");
      room.status = "IN_ROUND";
      room.currentRoundId = reservation.roundId;
      room.roundIndex = reservation.roundIndex;

      await saveRoomState(bumpRoomVersion(state!));
    });

    return { roundId: reservation.roundId, roundIndex: reservation.roundIndex };
  } catch (error) {
    console.error("Round generation failed", error);

    await withRoomLock(params.roomId, async () => {
      const state = await loadRoomState(params.roomId);
      if (!state) return;

      if (state.room.currentRoundId === reservation.roundId) {
        state.room.status = previousStatus;
        state.room.currentRoundId = previousRoundId;
        state.room.roundIndex = previousRoundIndex;
      }

      delete state.rounds[reservation.roundId];
      delete state.roundPrivates[reservation.roundId];
      delete state.attempts[reservation.roundId];
      delete state.scores[reservation.roundId];
      await saveRoomState(bumpRoomVersion(state));
    });

    throw describeRoundGenerationError(error);
  }
}

export async function endRoundIfNeeded(params: {
  roomId: string;
  roundId: string;
}): Promise<{ status: "IN_ROUND" | "RESULTS" }> {
  return withRoomLock(params.roomId, async () => {
    const state = await loadRoomState(params.roomId);
    const room = requireRoom(state?.room);
    const roundDoc = state?.rounds[params.roundId];

    if (!roundDoc) {
      throw new AppError("ROUND_NOT_FOUND", "Round does not exist", false, 404);
    }

    const endsAt = parseDate(roundDoc.endsAt);
    if (
      room.status !== "IN_ROUND" ||
      room.currentRoundId !== params.roundId ||
      !endsAt ||
      Date.now() < endsAt.getTime()
    ) {
      return { status: "IN_ROUND" };
    }

    const roundPrivate = state?.roundPrivates[params.roundId];

    roundDoc.status = "RESULTS";
    roundDoc.reveal = {
      gmPromptPublic: roundPrivate?.gmPrompt ?? "",
    };

    room.status = "RESULTS";

    await saveRoomState(bumpRoomVersion(state!));
    return { status: "RESULTS" };
  });
}

export async function endGame(roomId: string): Promise<void> {
  await withRoomLock(roomId, async () => {
    const state = await loadRoomState(roomId);
    if (!state) return;
    state.room.status = "FINISHED";
    await saveRoomState(bumpRoomVersion(state));
  });
}

export async function resetRoomForReplay(roomId: string): Promise<void> {
  await withRoomLock(roomId, async () => {
    const state = await loadRoomState(roomId);
    if (!state) return;

    const players = Object.values(state.players);
    if (!players.length) {
      state.room.status = "FINISHED";
      await saveRoomState(bumpRoomVersion(state));
      return;
    }

    state.room.status = "LOBBY";
    state.room.currentRoundId = null;
    state.room.roundIndex = 0;
    state.rounds = {};
    state.roundPrivates = {};
    state.attempts = {};
    state.scores = {};

    for (const player of players) {
      player.ready = false;
      player.totalScore = 0;
      player.lastSeenAt = new Date();
    }

    await saveRoomState(bumpRoomVersion(state));
  });
}

export const __test__ = {
  describeRoundGenerationError,
};
