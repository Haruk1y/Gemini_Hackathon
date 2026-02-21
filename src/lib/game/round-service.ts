import { Timestamp } from "firebase-admin/firestore";

import {
  roundPrivateRef,
  roundRef,
  roomRef,
  playerRef,
  playersRef,
} from "@/lib/api/paths";
import {
  captionFromImage,
  embedText,
  generateGmPrompt,
  generateImage,
  imageToBuffer,
  imageToPublicUrl,
} from "@/lib/gemini/client";
import { nextRoundId } from "@/lib/game/defaults";
import { requirePlayer, requireRoom } from "@/lib/game/guards";
import { assertCanStartRound } from "@/lib/game/room-service";
import { assertRoomTransition } from "@/lib/game/state-machine";
import { normalizeCaption } from "@/lib/scoring/normalize-caption";
import { uploadImageToStorage } from "@/lib/storage/upload-image";
import type { RoundPublicDoc, RoomStatus } from "@/lib/types/game";
import { AppError } from "@/lib/utils/errors";
import { dateAfterHours, parseDate } from "@/lib/utils/time";

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
      path: `rooms/${params.roomId}/rounds/${params.roundId}/${params.subPath}`,
      buffer,
      mimeType: params.image.mimeType,
    });
  } catch (error) {
    console.warn("Image storage upload fallback", params.roomId, params.roundId, error);
    if (!directUrl) {
      throw new AppError("GEMINI_ERROR", "No fallback image URL available", true, 502);
    }
    return directUrl;
  }
}

export async function startRound(params: {
  roomId: string;
  uid: string;
}): Promise<{ roundId: string; roundIndex: number }> {
  const roomSnapshot = await roomRef(params.roomId).get();
  const room = requireRoom(roomSnapshot);

  const playerSnapshot = await playerRef(params.roomId, params.uid).get();
  const player = requirePlayer(playerSnapshot);

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

  const playersSnapshot = await playersRef(params.roomId).get();
  const players = playersSnapshot.docs.map((snapshot) => snapshot.data() as { ready: boolean });
  assertCanStartRound(players);

  const nextIndex = room.roundIndex + 1;
  if (nextIndex > room.settings.totalRounds) {
    await roomRef(params.roomId).update({ status: "FINISHED" });
    throw new AppError("VALIDATION_ERROR", "All rounds are completed", false, 409);
  }

  const roundId = nextRoundId(nextIndex);
  const now = new Date();
  const expiresAt = dateAfterHours(24);

  assertRoomTransition(room.status, "GENERATING_ROUND");

  await roomRef(params.roomId).update({
    status: "GENERATING_ROUND",
    currentRoundId: roundId,
    roundIndex: nextIndex,
  });

  const baseRoundDoc: RoundPublicDoc = {
    roundId,
    index: nextIndex,
    status: "GENERATING",
    createdAt: now,
    expiresAt,
    startedAt: null,
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

  await roundRef(params.roomId, roundId).set(baseRoundDoc);

  try {
    const gmPrompt = await generateGmPrompt(room.settings);
    const targetImage = await generateImage({
      prompt: gmPrompt.prompt,
      aspectRatio: room.settings.aspectRatio,
    });

    const targetImageUrl = await resolveImageUrl({
      roomId: params.roomId,
      roundId,
      subPath: "target.png",
      prompt: gmPrompt.prompt,
      image: targetImage,
    });

    const targetCaptionJson = await captionFromImage(targetImage, gmPrompt.prompt);
    const targetCaptionText = normalizeCaption(targetCaptionJson);
    const targetEmbedding = await embedText(targetCaptionText);

    const startedAt = new Date();
    const endsAt = new Date(startedAt.getTime() + room.settings.roundSeconds * 1000);

    await roundRef(params.roomId, roundId).update({
      status: "IN_ROUND",
      startedAt,
      endsAt,
      targetImageUrl,
      targetThumbUrl: targetImageUrl,
      gmTitle: gmPrompt.title,
      gmTags: gmPrompt.tags,
      difficulty: gmPrompt.difficulty,
      reveal: {},
    });

    await roundPrivateRef(params.roomId, roundId).set({
      roundId,
      createdAt: startedAt,
      expiresAt,
      gmPrompt: gmPrompt.prompt,
      gmNegativePrompt: gmPrompt.negativePrompt ?? "",
      targetCaptionJson,
      targetCaptionText,
      targetEmbedding,
      targetEmbedModel: "gemini-embedding-001",
      targetEmbedDim: targetEmbedding.length,
      safety: {
        blocked: false,
      },
    });

    assertRoomTransition("GENERATING_ROUND", "IN_ROUND");
    await roomRef(params.roomId).update({
      status: "IN_ROUND",
      currentRoundId: roundId,
      roundIndex: nextIndex,
    });

    return { roundId, roundIndex: nextIndex };
  } catch (error) {
    console.error("Round generation failed", error);

    const rollbackStatus: RoomStatus = room.status;
    await roomRef(params.roomId).update({
      status: rollbackStatus,
      currentRoundId: room.currentRoundId,
      roundIndex: room.roundIndex,
    });

    throw new AppError("GEMINI_ERROR", "Failed to prepare round", true, 502);
  }
}

export async function endRoundIfNeeded(params: {
  roomId: string;
  roundId: string;
}): Promise<{ status: "IN_ROUND" | "RESULTS" }> {
  const roomSnapshot = await roomRef(params.roomId).get();
  const room = requireRoom(roomSnapshot);

  const roundSnapshot = await roundRef(params.roomId, params.roundId).get();
  if (!roundSnapshot.exists) {
    throw new AppError("ROUND_NOT_FOUND", "Round does not exist", false, 404);
  }

  const roundDoc = roundSnapshot.data() as RoundPublicDoc;
  const endsAt = parseDate(roundDoc.endsAt);

  if (
    room.status !== "IN_ROUND" ||
    room.currentRoundId !== params.roundId ||
    !endsAt ||
    Date.now() < endsAt.getTime()
  ) {
    return { status: "IN_ROUND" };
  }

  const roundPrivateSnapshot = await roundPrivateRef(params.roomId, params.roundId).get();
  const roundPrivate = (roundPrivateSnapshot.exists
    ? roundPrivateSnapshot.data()
    : { gmPrompt: "", targetCaptionText: "" }) as {
    gmPrompt: string;
    targetCaptionText: string;
  };

  await roundRef(params.roomId, params.roundId).update({
    status: "RESULTS",
    reveal: {
      targetCaption: roundPrivate.targetCaptionText,
      gmPromptPublic: roundPrivate.gmPrompt,
    },
  });

  await roomRef(params.roomId).update({
    status: "RESULTS",
  });

  return { status: "RESULTS" };
}

export async function endGame(roomId: string): Promise<void> {
  await roomRef(roomId).update({
    status: "FINISHED",
  });
}

export function computeTotalScoreDelta(
  currentTotal: number,
  oldBest: number,
  newBest: number,
): number {
  return Math.max(0, currentTotal - oldBest + newBest);
}

export function roundedScore(value: number): number {
  return Math.round(value);
}

export function nowTimestamp(): Timestamp {
  return Timestamp.now();
}
