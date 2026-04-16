import {
  captionFromImage,
  generateGmPrompt,
  generateImage,
  imageToBuffer,
  imageToPublicUrl,
  rewriteCpuPrompt,
  scoreImageSimilarity,
  type GeneratedImage,
} from "@/lib/gemini/client";
import { nextRoundId } from "@/lib/game/defaults";
import { requirePlayer, requireRoom } from "@/lib/game/guards";
import {
  buildTelephonePrompt,
  chooseCpuVote,
  chooseImpostorAssignments,
  IMPOSTOR_SIMILARITY_THRESHOLD,
  IMPOSTOR_TIMEOUT_PROMPT,
  reconstructPromptFromCaption,
  resetPlayerReadinessForLobby,
  resolveVoteTarget,
  sortPlayersBySeatOrder,
  syncCpuPlayers,
} from "@/lib/game/impostor";
import {
  getRoundSchedule,
  getRoundSubmissionDeadline,
  RESULTS_GRACE_SECONDS,
} from "@/lib/game/modes";
import { assertCanStartRound } from "@/lib/game/room-service";
import { assertRoomTransition } from "@/lib/game/state-machine";
import {
  bumpRoomVersion,
  loadRoomState,
  saveRoomState,
  withRoomLock,
  withSubmitLock,
} from "@/lib/server/room-state";
import { buildRoundTargetImagePath } from "@/lib/storage/paths";
import { uploadImageToStorage } from "@/lib/storage/upload-image";
import type {
  ImpostorFinalJudge,
  ImpostorRoundModeState,
  ImpostorRoundPrivateState,
  ImpostorTurnRecord,
  PlayerDoc,
  RoundPrivateDoc,
  RoundPublicDoc,
  RoomStatus,
} from "@/lib/types/game";
import { AppError } from "@/lib/utils/errors";
import { dateAfterHours, parseDate } from "@/lib/utils/time";

type CpuTurnScheduler = (params: { roomId: string; roundId: string }) => void | Promise<void>;

function hasScoringAttempts(
  attemptsByUid: Record<string, { attempts: Array<{ status?: string }> }> | undefined,
): boolean {
  return Object.values(attemptsByUid ?? {}).some((attemptDoc) =>
    attemptDoc.attempts.some((attempt) => attempt.status === "SCORING"),
  );
}

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

async function fetchImageBytes(url: string): Promise<GeneratedImage | null> {
  try {
    if (url.startsWith("data:")) {
      const match = url.match(/^data:([^;,]+)(;base64)?,(.+)$/);
      if (!match) return null;
      const mimeType = match[1] ?? "image/png";
      const isBase64 = Boolean(match[2]);
      const payload = match[3] ?? "";

      return {
        mimeType,
        base64Data: isBase64
          ? payload
          : Buffer.from(decodeURIComponent(payload), "utf8").toString("base64"),
        directUrl: url,
      };
    }

    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;

    const mimeType = response.headers.get("content-type")?.split(";")[0] ?? "image/png";
    const arrayBuffer = await response.arrayBuffer();
    return {
      mimeType,
      base64Data: Buffer.from(arrayBuffer).toString("base64"),
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

async function resolveTurnImageUrl(params: {
  roomId: string;
  roundId: string;
  uid: string;
  turnIndex: number;
  prompt: string;
  image: GeneratedImage;
}): Promise<string> {
  return resolveImageUrl({
    roomId: params.roomId,
    roundId: params.roundId,
    subPath: `turns/${String(params.turnIndex + 1).padStart(2, "0")}-${params.uid}.png`,
    prompt: params.prompt,
    image: params.image,
  });
}

function requireImpostorRoundState(
  round: RoundPublicDoc | undefined,
  roundPrivate: RoundPrivateDoc | undefined,
): {
  round: RoundPublicDoc & { modeState: ImpostorRoundModeState };
  roundPrivate: RoundPrivateDoc & { modeState: ImpostorRoundPrivateState };
} {
  if (!round || !roundPrivate || round.modeState?.kind !== "impostor" || !roundPrivate.modeState) {
    throw new AppError("ROUND_NOT_FOUND", "Art Impostor round state is missing", false, 404);
  }

  return {
    round: round as RoundPublicDoc & { modeState: ImpostorRoundModeState },
    roundPrivate: roundPrivate as RoundPrivateDoc & { modeState: ImpostorRoundPrivateState },
  };
}

function currentTurnPlayer(
  players: Record<string, PlayerDoc>,
  round: RoundPublicDoc & { modeState: ImpostorRoundModeState },
) {
  const currentUid = round.modeState.currentTurnUid;
  return currentUid ? players[currentUid] ?? null : null;
}

function setImpostorTurnDeadline(round: RoundPublicDoc, turnSeconds: number, startsAt = new Date()) {
  round.promptStartsAt = startsAt;
  round.endsAt = new Date(startsAt.getTime() + turnSeconds * 1000);
}

function clearImpostorTurnDeadline(round: RoundPublicDoc) {
  round.promptStartsAt = null;
  round.endsAt = null;
}

function syncImpostorTurnDeadline(params: {
  players: Record<string, PlayerDoc>;
  round: RoundPublicDoc & { modeState: ImpostorRoundModeState };
  turnSeconds: number;
  startsAt?: Date;
}) {
  const player = currentTurnPlayer(params.players, params.round);
  if (!player || player.kind === "cpu") {
    clearImpostorTurnDeadline(params.round);
    return;
  }

  setImpostorTurnDeadline(params.round, params.turnSeconds, params.startsAt);
}

function maybeRevealImpostorRound(params: {
  players: Record<string, PlayerDoc>;
  round: RoundPublicDoc & { modeState: ImpostorRoundModeState };
  roundPrivate: RoundPrivateDoc & { modeState: ImpostorRoundPrivateState };
}): boolean {
  const voteCount = Object.keys(params.roundPrivate.modeState.votesByUid).length;
  const totalPlayers = Object.keys(params.players).length;

  params.round.modeState.voteCount = voteCount;

  if (voteCount < totalPlayers) {
    return false;
  }

  const resolved = resolveVoteTarget(params.roundPrivate.modeState.votesByUid);
  params.round.modeState.phase = "REVEAL";
  params.round.modeState.voteCount = resolved.voteCount;
  params.round.modeState.voteTarget = resolved.targetUid;
  params.round.modeState.revealedTurns = params.roundPrivate.modeState.turnRecords.length;
  params.round.reveal = {
    gmPromptPublic: params.roundPrivate.gmPrompt,
  };
  return true;
}

function applyCpuVotes(params: {
  players: Record<string, PlayerDoc>;
  round: RoundPublicDoc & { modeState: ImpostorRoundModeState };
  roundPrivate: RoundPrivateDoc & { modeState: ImpostorRoundPrivateState };
}) {
  const createdAt = new Date();

  for (const player of Object.values(params.players)) {
    if (player.kind !== "cpu" || params.roundPrivate.modeState.votesByUid[player.uid]) {
      continue;
    }

    const role = params.roundPrivate.modeState.rolesByUid[player.uid];
    if (!role) {
      continue;
    }

    const vote = chooseCpuVote({
      uid: player.uid,
      role,
      turnOrder: params.round.modeState.turnOrder,
      turnRecords: params.roundPrivate.modeState.turnRecords,
      rolesByUid: params.roundPrivate.modeState.rolesByUid,
    });

    if (!vote.targetUid) {
      continue;
    }

    params.roundPrivate.modeState.votesByUid[player.uid] = vote.targetUid;
    params.roundPrivate.modeState.cpuVoteMeta.push({
      uid: player.uid,
      targetUid: vote.targetUid,
      reason: vote.reason,
      createdAt,
    });
  }
}

async function continueImpostorCpuTurns(params: {
  roomId: string;
  roundId: string;
  scheduleCpuTurns?: CpuTurnScheduler;
}) {
  if (params.scheduleCpuTurns) {
    await params.scheduleCpuTurns({
      roomId: params.roomId,
      roundId: params.roundId,
    });
    return;
  }

  await runImpostorCpuTurns({
    roomId: params.roomId,
    roundId: params.roundId,
  });
}

async function executeImpostorTurn(params: {
  roomId: string;
  roundId: string;
  uid: string;
  submittedPrompt?: string;
  timedOut?: boolean;
}): Promise<void> {
  await withSubmitLock(params.roomId, params.roundId, params.uid, async () => {
    const initialState = await loadRoomState(params.roomId);
    const room = requireRoom(initialState?.room);
    const { round, roundPrivate } = requireImpostorRoundState(
      initialState?.rounds[params.roundId],
      initialState?.roundPrivates[params.roundId],
    );
    const player = requirePlayer(initialState?.players[params.uid]);

    if (room.currentRoundId !== params.roundId || room.status !== "IN_ROUND") {
      throw new AppError("ROUND_CLOSED", "This round is not active", false, 409);
    }

    if (round.status !== "IN_ROUND" || round.modeState.phase !== "CHAIN") {
      throw new AppError("ROUND_CLOSED", "Art Impostor chain is already closed", false, 409);
    }

    if (round.modeState.currentTurnUid !== params.uid) {
      throw new AppError("ROUND_CLOSED", "It is not your turn", false, 409);
    }

    const turnEndsAt = parseDate(round.endsAt);
    if (!params.timedOut && turnEndsAt && Date.now() >= turnEndsAt.getTime()) {
      throw new AppError("ROUND_CLOSED", "Turn already ended", false, 409);
    }

    const role = roundPrivate.modeState.rolesByUid[params.uid];
    if (!role) {
      throw new AppError("INTERNAL_ERROR", "Player role is missing", true, 500);
    }

    const referenceImageUrl = round.modeState.chainImageUrl || round.targetImageUrl;
    const referenceImage = await fetchImageBytes(referenceImageUrl);
    if (!referenceImage?.base64Data) {
      throw new AppError("GEMINI_ERROR", "Failed to load reference image", true, 502);
    }

    let prompt = params.submittedPrompt?.trim() ?? "";

    if (player.kind === "cpu") {
      const caption = await captionFromImage(referenceImage, "reconstruct the image");
      const reconstructedPrompt = reconstructPromptFromCaption(caption);
      prompt =
        (await rewriteCpuPrompt({
          role,
          caption,
          reconstructedPrompt,
        })) ??
        buildTelephonePrompt({
          role,
          reconstructedPrompt,
        });
    } else if (!prompt) {
      prompt = IMPOSTOR_TIMEOUT_PROMPT;
    }

    const generatedImage = await generateImage({
      prompt,
      aspectRatio: room.settings.aspectRatio,
    });
    const transientImageUrl = imageToPublicUrl(generatedImage, prompt) ?? undefined;
    const attemptImage = await imageForVisualScoring(generatedImage, transientImageUrl);

    if (!attemptImage?.base64Data) {
      throw new AppError("GEMINI_ERROR", "Failed to prepare generated image for scoring", true, 502);
    }

    const judged = await scoreImageSimilarity({
      targetImage: referenceImage,
      attemptImage,
    });

    const isLastTurn = round.modeState.currentTurnIndex >= round.modeState.turnOrder.length - 1;
    let finalJudge: ImpostorFinalJudge | null = null;

    if (isLastTurn) {
      const originalTarget = await fetchImageBytes(round.targetImageUrl);
      if (!originalTarget?.base64Data) {
        throw new AppError("GEMINI_ERROR", "Failed to load original image for final judge", true, 502);
      }

      const finalResult = await scoreImageSimilarity({
        targetImage: originalTarget,
        attemptImage,
      });

      finalJudge = {
        score: finalResult.score,
        matchedElements: finalResult.matchedElements ?? [],
        missingElements: finalResult.missingElements ?? [],
        note: finalResult.note ?? "最終類似度を比較",
      };
    }

    const createdAt = new Date();
    const imageUrl = await resolveTurnImageUrl({
      roomId: params.roomId,
      roundId: params.roundId,
      uid: params.uid,
      turnIndex: round.modeState.currentTurnIndex,
      prompt,
      image: generatedImage,
    });

    await withRoomLock(params.roomId, async () => {
      const latestState = await loadRoomState(params.roomId);
      const latestRoom = requireRoom(latestState?.room);
      const validated = requireImpostorRoundState(
        latestState?.rounds[params.roundId],
        latestState?.roundPrivates[params.roundId],
      );

      if (
        latestRoom.currentRoundId !== params.roundId ||
        latestRoom.status !== "IN_ROUND" ||
        validated.round.modeState.phase !== "CHAIN" ||
        validated.round.modeState.currentTurnUid !== params.uid
      ) {
        throw new AppError("ROUND_CLOSED", "Impostor turn state was replaced", false, 409);
      }

      const turnRecord: ImpostorTurnRecord = {
        uid: params.uid,
        displayName: player.displayName,
        kind: player.kind,
        role,
        prompt,
        imageUrl,
        referenceImageUrl,
        similarityScore: judged.score,
        matchedElements: judged.matchedElements ?? [],
        missingElements: judged.missingElements ?? [],
        judgeNote: judged.note ?? "画像の見た目比較で採点",
        createdAt,
        timedOut: params.timedOut,
      };

      validated.roundPrivate.modeState.turnRecords.push(turnRecord);
      validated.round.modeState.chainImageUrl = imageUrl;
      validated.round.stats.submissions = validated.roundPrivate.modeState.turnRecords.length;
      validated.round.stats.topScore = Math.max(validated.round.stats.topScore ?? 0, judged.score);

      if (!isLastTurn) {
        validated.round.modeState.currentTurnIndex += 1;
        validated.round.modeState.currentTurnUid =
          validated.round.modeState.turnOrder[validated.round.modeState.currentTurnIndex] ?? null;
        syncImpostorTurnDeadline({
          players: latestState!.players,
          round: validated.round,
          turnSeconds: latestRoom.settings.roundSeconds,
          startsAt: createdAt,
        });
        await saveRoomState(bumpRoomVersion(latestState!));
        return;
      }

      validated.round.status = "RESULTS";
      validated.round.modeState.phase = "VOTING";
      validated.round.modeState.currentTurnIndex = validated.round.modeState.turnOrder.length;
      validated.round.modeState.currentTurnUid = null;
      validated.round.modeState.finalSimilarityScore = finalJudge?.score ?? judged.score;
      validated.round.modeState.revealedTurns = 0;
      validated.round.modeState.voteCount = 0;
      validated.round.modeState.voteTarget = null;
      validated.round.reveal = {};
      validated.roundPrivate.modeState.finalJudge = finalJudge;
      validated.round.endsAt = createdAt;
      validated.round.promptStartsAt = createdAt;

      latestRoom.status = "RESULTS";

      applyCpuVotes({
        players: latestState!.players,
        round: validated.round,
        roundPrivate: validated.roundPrivate,
      });
      maybeRevealImpostorRound({
        players: latestState!.players,
        round: validated.round,
        roundPrivate: validated.roundPrivate,
      });

      await saveRoomState(bumpRoomVersion(latestState!));
    });
  });
}

export async function runImpostorCpuTurns(params: {
  roomId: string;
  roundId: string;
}): Promise<void> {
  for (let index = 0; index < 12; index += 1) {
    const state = await loadRoomState(params.roomId);
    const room = state?.room;
    const round = state?.rounds[params.roundId];
    const roundPrivate = state?.roundPrivates[params.roundId];

    if (!state || !room || !round || !roundPrivate) {
      return;
    }

    const validated = requireImpostorRoundState(round, roundPrivate);
    if (room.status !== "IN_ROUND" || validated.round.modeState.phase !== "CHAIN") {
      return;
    }

    const player = currentTurnPlayer(state.players, validated.round);
    if (!player || player.kind !== "cpu") {
      return;
    }

    await executeImpostorTurn({
      roomId: params.roomId,
      roundId: params.roundId,
      uid: player.uid,
    });
  }
}

export async function voteInRound(params: {
  roomId: string;
  roundId: string;
  uid: string;
  targetUid: string;
}): Promise<{ phase: "VOTING" | "REVEAL" }> {
  return withRoomLock(params.roomId, async () => {
    const state = await loadRoomState(params.roomId);
    const room = requireRoom(state?.room);
    const player = requirePlayer(state?.players[params.uid]);
    const targetPlayer = requirePlayer(state?.players[params.targetUid]);
    const validated = requireImpostorRoundState(
      state?.rounds[params.roundId],
      state?.roundPrivates[params.roundId],
    );

    if (room.currentRoundId !== params.roundId || room.status !== "RESULTS" || validated.round.status !== "RESULTS") {
      throw new AppError("ROUND_CLOSED", "Result voting is not active", false, 409);
    }

    if (validated.round.modeState.phase === "REVEAL") {
      throw new AppError("ROUND_CLOSED", "Votes are already locked", false, 409);
    }

    if (player.kind !== "human") {
      throw new AppError("VALIDATION_ERROR", "CPU players cannot vote via API", false, 409);
    }

    if (targetPlayer.uid === player.uid) {
      throw new AppError("VALIDATION_ERROR", "自分自身には投票できません。", false, 409);
    }

    validated.roundPrivate.modeState.votesByUid[player.uid] = targetPlayer.uid;
    maybeRevealImpostorRound({
      players: state!.players,
      round: validated.round,
      roundPrivate: validated.roundPrivate,
    });

    await saveRoomState(bumpRoomVersion(state!));
    const phase = validated.round.modeState.phase as "VOTING" | "REVEAL";

    return {
      phase,
    };
  });
}

function createBaseRoundDoc(params: {
  roundId: string;
  roundIndex: number;
  now: Date;
  expiresAt: Date;
}): RoundPublicDoc {
  return {
    roundId: params.roundId,
    index: params.roundIndex,
    status: "GENERATING",
    createdAt: params.now,
    expiresAt: params.expiresAt,
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
}

export async function startRound(params: {
  roomId: string;
  uid: string;
  scheduleCpuTurns?: CpuTurnScheduler;
}): Promise<{ roundId: string; roundIndex: number }> {
  const reservation = await withRoomLock(params.roomId, async () => {
    const state = await loadRoomState(params.roomId);
    const room = requireRoom(state?.room);
    const player = requirePlayer(state?.players[params.uid]);

    if (!player.isHost) {
      throw new AppError("NOT_HOST", "Only host can start rounds", false, 403);
    }

    syncCpuPlayers(state!);

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

    state!.rounds[roundId] = createBaseRoundDoc({
      roundId,
      roundIndex: nextIndex,
      now,
      expiresAt,
    });
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

      if (room.settings.gameMode === "impostor") {
        const players = sortPlayersBySeatOrder(Object.values(state!.players));
        const assignment = chooseImpostorAssignments(players);

        round.modeState = {
          kind: "impostor",
          phase: "CHAIN",
          turnOrder: assignment.turnOrder,
          currentTurnIndex: 0,
          currentTurnUid: assignment.turnOrder[0] ?? null,
          chainImageUrl: targetImageUrl,
          similarityThreshold: IMPOSTOR_SIMILARITY_THRESHOLD,
          finalSimilarityScore: null,
          voteCount: 0,
          voteTarget: null,
          revealedTurns: 0,
        };
        roundPrivate.modeState = {
          rolesByUid: assignment.rolesByUid,
          turnRecords: [],
          votesByUid: {},
          finalJudge: null,
          cpuVoteMeta: [],
        };
        syncImpostorTurnDeadline({
          players: state!.players,
          round: round as RoundPublicDoc & { modeState: ImpostorRoundModeState },
          turnSeconds: room.settings.roundSeconds,
          startsAt: startedAt,
        });
      }

      assertRoomTransition("GENERATING_ROUND", "IN_ROUND");
      room.status = "IN_ROUND";
      room.currentRoundId = reservation.roundId;
      room.roundIndex = reservation.roundIndex;

      await saveRoomState(bumpRoomVersion(state!));
    });

    if (reservation.settings.gameMode === "impostor") {
      await continueImpostorCpuTurns({
        roomId: params.roomId,
        roundId: reservation.roundId,
        scheduleCpuTurns: params.scheduleCpuTurns,
      });
    }

    return { roundId: reservation.roundId, roundIndex: reservation.roundIndex };
  } catch (error) {
    console.error("Round generation failed", error);

    await withRoomLock(params.roomId, async () => {
      const state = await loadRoomState(params.roomId);
      if (!state) return;

      if (state.room.currentRoundId === reservation.roundId) {
        state.room.status = reservation.previousStatus;
        state.room.currentRoundId = reservation.previousRoundId;
        state.room.roundIndex = reservation.previousRoundIndex;
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
  scheduleCpuTurns?: CpuTurnScheduler;
}): Promise<{ status: "IN_ROUND" | "RESULTS" }> {
  const state = await loadRoomState(params.roomId);
  const room = requireRoom(state?.room);
  const roundDoc = state?.rounds[params.roundId];

  if (!roundDoc) {
    throw new AppError("ROUND_NOT_FOUND", "Round does not exist", false, 404);
  }

  if (room.settings.gameMode !== "impostor" || roundDoc.modeState?.kind !== "impostor") {
    return withRoomLock(params.roomId, async () => {
      const latestState = await loadRoomState(params.roomId);
      const latestRoom = requireRoom(latestState?.room);
      const latestRound = latestState?.rounds[params.roundId];

      if (!latestRound) {
        throw new AppError("ROUND_NOT_FOUND", "Round does not exist", false, 404);
      }

      const endsAt = parseDate(latestRound.endsAt);
      const now = Date.now();
      if (
        latestRoom.status !== "IN_ROUND" ||
        latestRound.status !== "IN_ROUND" ||
        latestRoom.currentRoundId !== params.roundId ||
        !endsAt ||
        now < endsAt.getTime()
      ) {
        return { status: latestRoom.status === "RESULTS" ? "RESULTS" : "IN_ROUND" };
      }

      if (hasScoringAttempts(latestState?.attempts[params.roundId])) {
        return { status: "IN_ROUND" };
      }

      const submissionDeadline = getRoundSubmissionDeadline({
        promptStartsAt: latestRound.promptStartsAt,
        roundSeconds: latestRoom.settings.roundSeconds,
      });
      const isGraceWindow = Boolean(
        submissionDeadline && endsAt.getTime() > submissionDeadline.getTime(),
      );
      const isShortenedResultsCountdown = Boolean(
        submissionDeadline && endsAt.getTime() < submissionDeadline.getTime(),
      );

      if (
        submissionDeadline &&
        now >= submissionDeadline.getTime() &&
        !isGraceWindow &&
        !isShortenedResultsCountdown
      ) {
        latestRound.endsAt = new Date(now + RESULTS_GRACE_SECONDS * 1000);
        await saveRoomState(bumpRoomVersion(latestState!));
        return { status: "IN_ROUND" };
      }

      const roundPrivate = latestState?.roundPrivates[params.roundId];

      latestRound.status = "RESULTS";
      latestRound.reveal = {
        gmPromptPublic: roundPrivate?.gmPrompt ?? "",
      };

      latestRoom.status = "RESULTS";

      await saveRoomState(bumpRoomVersion(latestState!));
      return { status: "RESULTS" };
    });
  }

  if (room.status === "RESULTS") {
    return { status: "RESULTS" };
  }

  const validated = requireImpostorRoundState(
    state?.rounds[params.roundId],
    state?.roundPrivates[params.roundId],
  );

  const endsAt = parseDate(validated.round.endsAt);
  if (
    room.status !== "IN_ROUND" ||
    room.currentRoundId !== params.roundId ||
    validated.round.modeState.phase !== "CHAIN" ||
    !endsAt ||
    Date.now() < endsAt.getTime()
  ) {
    return { status: "IN_ROUND" };
  }

  const player = currentTurnPlayer(state!.players, validated.round);
  if (!player) {
    return { status: "IN_ROUND" };
  }

  await executeImpostorTurn({
    roomId: params.roomId,
    roundId: params.roundId,
    uid: player.uid,
    submittedPrompt: player.kind === "human" ? IMPOSTOR_TIMEOUT_PROMPT : undefined,
    timedOut: player.kind === "human",
  });
  await continueImpostorCpuTurns({
    roomId: params.roomId,
    roundId: params.roundId,
    scheduleCpuTurns: params.scheduleCpuTurns,
  });

  const nextState = await loadRoomState(params.roomId);
  return {
    status: nextState?.room.status === "RESULTS" ? "RESULTS" : "IN_ROUND",
  };
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

    syncCpuPlayers(state);
    const humanPlayers = Object.values(state.players).filter((player) => player.kind === "human");
    if (!humanPlayers.length) {
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
    resetPlayerReadinessForLobby(state.players);

    await saveRoomState(bumpRoomVersion(state));
  });
}

export async function submitImpostorTurn(params: {
  roomId: string;
  roundId: string;
  uid: string;
  prompt: string;
  scheduleCpuTurns?: CpuTurnScheduler;
}): Promise<void> {
  await executeImpostorTurn({
    roomId: params.roomId,
    roundId: params.roundId,
    uid: params.uid,
    submittedPrompt: params.prompt,
  });
  await continueImpostorCpuTurns({
    roomId: params.roomId,
    roundId: params.roundId,
    scheduleCpuTurns: params.scheduleCpuTurns,
  });
}

export const __test__ = {
  describeRoundGenerationError,
};
