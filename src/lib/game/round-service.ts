import {
  captionFromImage,
  generateChangeEditPlan,
  generateChangeScenePrompt,
  generateGmPrompt,
  rewriteCpuPrompt,
  scoreImageSimilarity,
  validateSingleChangeEdit,
} from "@/lib/gemini/client";
import { nextRoundId } from "@/lib/game/defaults";
import {
  CHANGE_MIN_PLAYERS,
  countCorrectChangeGuesses,
  countSubmittedChangeGuesses,
  createChangeSubmission,
  createMockChangeRoundAssets,
  isPointInsideNormalizedBox,
  listHumanPlayers,
} from "@/lib/game/change-mode";
import {
  ChangeImageDiffError,
  computeLocalizedChangeImageDiff,
} from "@/lib/game/change-image-diff";
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
  reserveClassicRoundAttemptInState,
  submitClassicRoundAttemptWithReservation,
} from "@/lib/game/classic-submit";
import {
  getRoundSchedule,
  getRoundSubmissionDeadline,
  RESULTS_GRACE_SECONDS,
} from "@/lib/game/modes";
import { assertRoundSubmissionWindow } from "@/lib/game/round-validation";
import { DEFAULT_LANGUAGE, type Language } from "@/lib/i18n/language";
import { assertCanStartRound } from "@/lib/game/room-service";
import { assertRoomTransition } from "@/lib/game/state-machine";
import {
  bumpRoomVersion,
  loadRoomState,
  saveRoomState,
  withRoomLock,
  withSubmitLock,
  type RoomState,
} from "@/lib/server/room-state";
import {
  generateImage,
  imageToBuffer,
  imageToPublicUrl,
  type GeneratedImage,
} from "@/lib/images";
import {
  buildRoundChangedImagePath,
  buildRoundTargetImagePath,
} from "@/lib/storage/paths";
import { uploadImageToStorage } from "@/lib/storage/upload-image";
import type {
  ChangePreparedRoundState,
  ChangeRoundModeState,
  ChangeRoundPrivateState,
  ChangeSubmission,
  ImpostorFinalJudge,
  ImpostorRoundModeState,
  ImpostorRoundPrivateState,
  ImpostorTurnRecord,
  NormalizedPoint,
  PlayerDoc,
  PreparedRoundDoc,
  RoundPrivateDoc,
  RoundPublicDoc,
  RoomStatus,
  RoomSettings,
} from "@/lib/types/game";
import { AppError } from "@/lib/utils/errors";
import { dateAfterHours, parseDate } from "@/lib/utils/time";

type CpuTurnScheduler = (params: { roomId: string; roundId: string }) => void | Promise<void>;

const PREPARED_ROUND_POLL_INTERVAL_MS = 120;
const PREPARED_ROUND_WAIT_TIMEOUT_MS = 45_000;
const PREPARED_ROUND_STALE_MS = 45_000;

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

interface RoundMaterial {
  roundId: string;
  roundIndex: number;
  createdAt: Date;
  expiresAt: Date;
  gmPrompt: string;
  gmTitle: string;
  gmTags: string[];
  difficulty: RoundPublicDoc["difficulty"];
  targetImageUrl: string;
  targetThumbUrl: string;
  stylePresetId?: string;
  modeState?: ChangePreparedRoundState;
}

function hasScoringAttempts(
  attemptsByUid: Record<string, { attempts: Array<{ status?: string }> }> | undefined,
): boolean {
  return Object.values(attemptsByUid ?? {}).some((attemptDoc) =>
    attemptDoc.attempts.some(
      (attempt) =>
        attempt.status === "GENERATING" || attempt.status === "SCORING",
    ),
  );
}

function summarizeTimeoutAutoSubmitError(error: unknown) {
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
        "お題画像の生成に失敗しました。画像生成プロバイダの設定または利用状況を確認して再試行してください。",
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

function allocateRoundId(state: RoomState): string {
  state.roundSequence += 1;
  return nextRoundId(state.roundSequence);
}

function buildPreparedRoundPlaceholder(params: {
  roundId: string;
  roundIndex: number;
  imageModel: RoomState["room"]["settings"]["imageModel"];
  createdAt: Date;
}): PreparedRoundDoc {
  return {
    roundId: params.roundId,
    index: params.roundIndex,
    status: "GENERATING",
    createdAt: params.createdAt,
    updatedAt: params.createdAt,
    imageModel: params.imageModel,
    gmPrompt: "",
    gmTitle: "Preparing...",
    gmTags: [],
    difficulty: 3,
    targetImageUrl: "",
    targetThumbUrl: "",
  };
}

function toRoundMaterialFromPrepared(
  preparedRound: PreparedRoundDoc,
  expiresAt = dateAfterHours(24),
): RoundMaterial {
  return {
    roundId: preparedRound.roundId,
    roundIndex: preparedRound.index,
    createdAt: preparedRound.createdAt,
    expiresAt,
    gmPrompt: preparedRound.gmPrompt,
    gmTitle: preparedRound.gmTitle,
    gmTags: preparedRound.gmTags,
    difficulty: preparedRound.difficulty,
    targetImageUrl: preparedRound.targetImageUrl,
    targetThumbUrl: preparedRound.targetThumbUrl,
    stylePresetId: preparedRound.stylePresetId,
    modeState: preparedRound.modeState,
  };
}

function currentStylePresetIds(state: RoomState): string[] {
  const ids = new Set<string>();
  const currentRoundId = state.room.currentRoundId;
  const currentStylePresetId = currentRoundId
    ? state.roundPrivates[currentRoundId]?.stylePresetId
    : undefined;

  if (currentStylePresetId) {
    ids.add(currentStylePresetId);
  }

  if (state.preparedRound?.stylePresetId) {
    ids.add(state.preparedRound.stylePresetId);
  }

  return [...ids];
}

export function isPreparedRoundStale(
  preparedRound: PreparedRoundDoc,
  now = Date.now(),
): boolean {
  const updatedAt = parseDate(preparedRound.updatedAt)?.getTime();
  const createdAt = parseDate(preparedRound.createdAt)?.getTime();
  const baseline = updatedAt ?? createdAt ?? now;
  return now - baseline > PREPARED_ROUND_STALE_MS;
}

export function shouldEnsurePreparedRound(params: {
  state: RoomState;
  now?: number;
}): boolean {
  const { state } = params;
  const room = state.room;

  if (room.status === "FINISHED") {
    return false;
  }

  const nextIndex = room.roundIndex + 1;
  if (nextIndex > room.settings.totalRounds) {
    return false;
  }

  const preparedRound = state.preparedRound;
  if (!preparedRound) {
    return true;
  }

  if (preparedRound.index !== nextIndex) {
    return true;
  }

  if (preparedRound.status === "FAILED") {
    return true;
  }

  if (preparedRound.status === "GENERATING") {
    return isPreparedRoundStale(preparedRound, params.now);
  }

  return false;
}

async function waitForPreparedRound(params: {
  roomId: string;
  roundId: string;
  roundIndex: number;
  timeoutMs?: number;
}): Promise<PreparedRoundDoc | null> {
  const deadline = Date.now() + (params.timeoutMs ?? PREPARED_ROUND_WAIT_TIMEOUT_MS);

  while (Date.now() < deadline) {
    const state = await loadRoomState(params.roomId);
    const preparedRound = state?.preparedRound;

    if (
      !preparedRound ||
      preparedRound.roundId !== params.roundId ||
      preparedRound.index !== params.roundIndex
    ) {
      return null;
    }

    if (preparedRound.status === "READY" || preparedRound.status === "FAILED") {
      return preparedRound;
    }

    if (isPreparedRoundStale(preparedRound)) {
      return null;
    }

    await sleep(PREPARED_ROUND_POLL_INTERVAL_MS);
  }

  return null;
}

async function isPreparedRoundReservationActive(params: {
  roomId: string;
  roundId: string;
  roundIndex: number;
}): Promise<boolean> {
  const state = await loadRoomState(params.roomId);
  const preparedRound = state?.preparedRound;

  return Boolean(
    preparedRound &&
      preparedRound.roundId === params.roundId &&
      preparedRound.index === params.roundIndex &&
      preparedRound.status === "GENERATING",
  );
}

function reserveSynchronousRoundStartInState(params: {
  state: RoomState;
  room: RoomState["room"];
  expectedRoundIndex: number;
}): {
  kind: "reserved";
  previousStatus: RoomStatus;
  previousRoundId: string | null;
  previousRoundIndex: number;
  roundId: string;
  roundIndex: number;
  settings: RoomState["room"]["settings"];
  expiresAt: Date;
  createdAt: Date;
  excludeStylePresetIds: string[];
} {
  const nextIndex = params.room.roundIndex + 1;
  if (nextIndex !== params.expectedRoundIndex) {
    throw new AppError("ROUND_CLOSED", "Round generation state was replaced", false, 409);
  }

  if (params.state.preparedRound?.index === nextIndex) {
    params.state.preparedRound = null;
  }

  const roundId = allocateRoundId(params.state);
  const now = new Date();
  const expiresAt = dateAfterHours(24);
  const previousStatus = params.room.status;
  const previousRoundId = params.room.currentRoundId;
  const previousRoundIndex = params.room.roundIndex;
  const excludeStylePresetIds = currentStylePresetIds(params.state);

  assertRoomTransition(params.room.status, "GENERATING_ROUND");

  params.room.status = "GENERATING_ROUND";
  params.room.currentRoundId = roundId;
  params.room.roundIndex = nextIndex;

  params.state.rounds[roundId] = createBaseRoundDoc({
    roundId,
    roundIndex: nextIndex,
    now,
    expiresAt,
  });
  params.state.roundPrivates[roundId] = {
    roundId,
    createdAt: now,
    expiresAt,
    gmPrompt: "",
    gmNegativePrompt: "",
    safety: {
      blocked: false,
    },
  };

  return {
    kind: "reserved" as const,
    previousStatus: previousStatus as RoomStatus,
    previousRoundId,
    previousRoundIndex,
    roundId,
    roundIndex: nextIndex,
    settings: params.room.settings,
    expiresAt,
    createdAt: now,
    excludeStylePresetIds,
  };
}

async function reserveSynchronousRoundStart(params: {
  roomId: string;
  expectedRoundIndex: number;
}): Promise<ReturnType<typeof reserveSynchronousRoundStartInState>> {
  return withRoomLock(params.roomId, async () => {
    const state = await loadRoomState(params.roomId);
    const room = requireRoom(state?.room);
    const reservation = reserveSynchronousRoundStartInState({
      state: state!,
      room,
      expectedRoundIndex: params.expectedRoundIndex,
    });
    await saveRoomState(bumpRoomVersion(state!));
    return reservation;
  });
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
  const directUrl = imageToPublicUrl(params.image);
  const buffer = imageToBuffer(params.image);

  if (!buffer || !params.image.base64Data) {
    if (!directUrl) {
      throw new AppError("GEMINI_ERROR", "No image output available", true, 502);
    }
    return directUrl;
  }

  try {
    return await uploadImageToStorage({
      path: params.subPath === "target.png"
        ? buildRoundTargetImagePath(params.roomId, params.roundId)
        : params.subPath === "changed.png"
          ? buildRoundChangedImagePath(params.roomId, params.roundId)
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

function isMockChangeGenerationMode() {
  return process.env.MOCK_GEMINI === "true" || !process.env.GEMINI_API_KEY;
}

function changeImageToDiffSource(image: GeneratedImage): Uint8Array | string {
  if (image.mimeType !== "image/png") {
    throw new AppError(
      "GEMINI_ERROR",
      "Change mode currently requires PNG image data for diffing.",
      true,
      502,
    );
  }

  if (image.base64Data) {
    return Buffer.from(image.base64Data, "base64");
  }

  if (typeof image.directUrl === "string" && image.directUrl.startsWith("data:image/png;base64,")) {
    return image.directUrl;
  }

  throw new AppError(
    "GEMINI_ERROR",
    "Localized change detection needs binary PNG image data.",
    true,
    502,
  );
}

async function buildChangeRoundMaterial(params: {
  roomId: string;
  roundId: string;
  roundIndex: number;
  createdAt: Date;
  expiresAt: Date;
  settings: RoomSettings;
}): Promise<RoundMaterial> {
  if (params.settings.imageModel !== "gemini") {
    throw new AppError(
      "MODE_REQUIRES_GEMINI",
      "Change mode requires Gemini image editing.",
      false,
      409,
    );
  }

  if (isMockChangeGenerationMode()) {
    const mockAssets = createMockChangeRoundAssets();
    return {
      roundId: params.roundId,
      roundIndex: params.roundIndex,
      createdAt: params.createdAt,
      expiresAt: params.expiresAt,
      gmPrompt:
        "A realistic kitchen counter scene with many small household props, stable camera, soft natural daylight, no text",
      gmTitle: "Kitchen Counter",
      gmTags: ["change", "kitchen", "props"],
      difficulty: 2,
      targetImageUrl: mockAssets.baseImage.directUrl ?? "",
      targetThumbUrl: mockAssets.baseImage.directUrl ?? "",
      stylePresetId: "change-realistic",
      modeState: {
        kind: "change",
        changedImageUrl: mockAssets.changedImage.directUrl ?? "",
        answerBox: mockAssets.answerBox,
        changeSummary: mockAssets.changeSummary,
      },
    };
  }

  const gmPrompt = await generateChangeScenePrompt({
    settings: params.settings,
    promptModel: params.settings.promptModel,
  });
  const baseImage = await generateImage({
    prompt: gmPrompt.prompt,
    aspectRatio: params.settings.aspectRatio,
    imageModel: params.settings.imageModel,
  });
  const baseImageForModeling = await imageForVisualScoring(
    baseImage,
    imageToPublicUrl(baseImage) ?? undefined,
  );

  if (!baseImageForModeling) {
    throw new AppError(
      "GEMINI_ERROR",
      "Failed to prepare the base image for change generation.",
      true,
      502,
    );
  }

  const caption = await captionFromImage(baseImageForModeling, gmPrompt.prompt, {
    promptModel: params.settings.promptModel,
  });
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const editPlan = await generateChangeEditPlan({
        caption,
        promptModel: params.settings.promptModel,
      });
      const changedImage = await generateImage({
        prompt: editPlan.editPrompt,
        aspectRatio: params.settings.aspectRatio,
        imageModel: params.settings.imageModel,
        sourceImage: baseImageForModeling,
      });
      const changedImageForModeling = await imageForVisualScoring(
        changedImage,
        imageToPublicUrl(changedImage) ?? undefined,
      );

      if (!changedImageForModeling) {
        throw new AppError(
          "GEMINI_ERROR",
          "Failed to prepare the edited image for localized diffing.",
          true,
          502,
        );
      }

      const diff = computeLocalizedChangeImageDiff(
        changeImageToDiffSource(baseImageForModeling),
        changeImageToDiffSource(changedImageForModeling),
        {
          paddingPixels: 12,
          maxDiffAreaRatio: 0.18,
          allowMultipleRegions: true,
        },
      );
      const validation = await validateSingleChangeEdit({
        beforeImage: baseImageForModeling,
        afterImage: changedImageForModeling,
        answerBox: diff.normalizedBoundingBox,
        promptModel: params.settings.promptModel,
      });

      if (!validation.valid) {
        lastError = new AppError(
          "GEMINI_ERROR",
          validation.note || "Edited image was not localized to one object.",
          true,
          502,
        );
        continue;
      }

      const targetImageUrl = await resolveImageUrl({
        roomId: params.roomId,
        roundId: params.roundId,
        subPath: "target.png",
        prompt: gmPrompt.prompt,
        image: baseImage,
      });
      const changedImageUrl = await resolveImageUrl({
        roomId: params.roomId,
        roundId: params.roundId,
        subPath: "changed.png",
        prompt: editPlan.editPrompt,
        image: changedImage,
      });

      return {
        roundId: params.roundId,
        roundIndex: params.roundIndex,
        createdAt: params.createdAt,
        expiresAt: params.expiresAt,
        gmPrompt: gmPrompt.prompt,
        gmTitle: gmPrompt.title,
        gmTags: gmPrompt.tags,
        difficulty: gmPrompt.difficulty as RoundPublicDoc["difficulty"],
        targetImageUrl,
        targetThumbUrl: targetImageUrl,
        stylePresetId: gmPrompt.stylePresetId,
        modeState: {
          kind: "change",
          changedImageUrl,
          answerBox: diff.normalizedBoundingBox,
          changeSummary: editPlan.editPrompt,
        },
      };
    } catch (error) {
      if (
        error instanceof ChangeImageDiffError ||
        (error instanceof AppError && error.code === "GEMINI_ERROR")
      ) {
        lastError = error;
        continue;
      }

      throw error;
    }
  }

  throw (
    lastError ??
    new AppError(
      "GEMINI_ERROR",
      "Failed to prepare a localized single-object change.",
      true,
      502,
    )
  );
}

function requireChangeRoundState(
  round: RoundPublicDoc | undefined,
  roundPrivate: RoundPrivateDoc | undefined,
): {
  round: RoundPublicDoc & { modeState: ChangeRoundModeState };
  roundPrivate: RoundPrivateDoc & { modeState: ChangeRoundPrivateState };
} {
  if (!round || !roundPrivate || round.modeState?.kind !== "change" || !roundPrivate.modeState) {
    throw new AppError("ROUND_NOT_FOUND", "Change round state is missing", false, 404);
  }

  return {
    round: round as RoundPublicDoc & { modeState: ChangeRoundModeState },
    roundPrivate: roundPrivate as RoundPrivateDoc & { modeState: ChangeRoundPrivateState },
  };
}

function syncChangeRoundStats(params: {
  round: RoundPublicDoc & { modeState: ChangeRoundModeState };
  roundPrivate: RoundPrivateDoc & { modeState: ChangeRoundPrivateState };
}) {
  const submittedCount = countSubmittedChangeGuesses(params.roundPrivate.modeState);
  const correctCount = countCorrectChangeGuesses(params.roundPrivate.modeState);
  const topScore = Object.values(params.roundPrivate.modeState.submissionsByUid).reduce(
    (highest, entry) => Math.max(highest, entry.score),
    0,
  );

  params.round.modeState.submittedCount = submittedCount;
  params.round.modeState.correctCount = correctCount;
  params.round.stats.submissions = submittedCount;
  params.round.stats.topScore = topScore;
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
      const caption = await captionFromImage(referenceImage, "reconstruct the image", {
        promptModel: room.settings.promptModel,
      });
      const reconstructedPrompt = reconstructPromptFromCaption(caption);
      prompt =
        (await rewriteCpuPrompt({
          role,
          caption,
          reconstructedPrompt,
          promptModel: room.settings.promptModel,
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
      imageModel: room.settings.imageModel,
    });
    const transientImageUrl = imageToPublicUrl(generatedImage) ?? undefined;
    const attemptImage = await imageForVisualScoring(generatedImage, transientImageUrl);

    if (!attemptImage?.base64Data) {
      throw new AppError("GEMINI_ERROR", "Failed to prepare generated image for scoring", true, 502);
    }

    const judged = await scoreImageSimilarity({
      targetImage: referenceImage,
      attemptImage,
      judgeModel: room.settings.judgeModel,
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
        judgeModel: room.settings.judgeModel,
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

export async function submitChangeRoundClick(params: {
  roomId: string;
  roundId: string;
  uid: string;
  point: NormalizedPoint;
}): Promise<{
  hit: boolean;
  score: number;
  rank: number | null;
  submittedCount: number;
  correctCount: number;
}> {
  return withRoomLock(params.roomId, async () => {
    const state = await loadRoomState(params.roomId);
    const room = requireRoom(state?.room);
    const player = requirePlayer(state?.players[params.uid]);
    const validated = requireChangeRoundState(
      state?.rounds[params.roundId],
      state?.roundPrivates[params.roundId],
    );

    if (room.settings.gameMode !== "change") {
      throw new AppError("VALIDATION_ERROR", "Change mode is not active.", false, 409);
    }

    if (player.kind !== "human") {
      throw new AppError("VALIDATION_ERROR", "CPU players cannot click via API", false, 409);
    }

    if (validated.roundPrivate.modeState.submissionsByUid[player.uid]) {
      throw new AppError(
        "ALREADY_GUESSED",
        "You already submitted a click for this round.",
        false,
        409,
      );
    }

    assertRoundSubmissionWindow({
      room,
      round: validated.round,
      roundId: params.roundId,
      now: new Date(),
    });

    const hit = isPointInsideNormalizedBox(
      params.point,
      validated.roundPrivate.modeState.answerBox,
    );
    const rank = hit
      ? countCorrectChangeGuesses(validated.roundPrivate.modeState) + 1
      : null;
    const submission = createChangeSubmission({
      player,
      point: params.point,
      hit,
      rank,
    });

    validated.roundPrivate.modeState.submissionsByUid[player.uid] = submission;
    syncChangeRoundStats({
      round: validated.round,
      roundPrivate: validated.roundPrivate,
    });

    if (submission.score > 0) {
      const roundScores = state!.scores[params.roundId] ?? {};
      roundScores[player.uid] = {
        uid: player.uid,
        displayName: player.displayName,
        bestScore: submission.score,
        bestImageUrl: "",
        updatedAt: submission.createdAt,
        expiresAt: dateAfterHours(24),
      };
      state!.scores[params.roundId] = roundScores;
      player.totalScore += submission.score;
    }

    await saveRoomState(bumpRoomVersion(state!));
    return {
      hit: submission.hit,
      score: submission.score,
      rank: submission.rank,
      submittedCount: validated.round.modeState.submittedCount,
      correctCount: validated.round.modeState.correctCount,
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

function applyMaterializedRound(params: {
  state: RoomState;
  room: RoomState["room"];
  material: RoundMaterial;
}) {
  const startedAt = new Date();
  const { promptStartsAt, endsAt } = getRoundSchedule({
    gameMode: params.room.settings.gameMode,
    roundSeconds: params.room.settings.roundSeconds,
    startedAt,
  });

  const round: RoundPublicDoc = {
    roundId: params.material.roundId,
    index: params.material.roundIndex,
    status: "IN_ROUND",
    createdAt: params.material.createdAt,
    expiresAt: params.material.expiresAt,
    startedAt,
    promptStartsAt,
    endsAt,
    targetImageUrl: params.material.targetImageUrl,
    targetThumbUrl: params.material.targetThumbUrl,
    gmTitle: params.material.gmTitle,
    gmTags: params.material.gmTags,
    difficulty: params.material.difficulty,
    reveal: {},
    stats: {
      submissions: 0,
      topScore: 0,
    },
  };

  const roundPrivate: RoundPrivateDoc = {
    roundId: params.material.roundId,
    createdAt: startedAt,
    expiresAt: params.material.expiresAt,
    gmPrompt: params.material.gmPrompt,
    gmNegativePrompt: "",
    stylePresetId: params.material.stylePresetId,
    safety: {
      blocked: false,
    },
  };

  if (params.room.settings.gameMode === "change") {
    if (!params.material.modeState || params.material.modeState.kind !== "change") {
      throw new AppError(
        "INTERNAL_ERROR",
        "Prepared change round assets are missing.",
        true,
        500,
      );
    }

    round.modeState = {
      kind: "change",
      baseImageUrl: params.material.targetImageUrl,
      changedImageUrl: params.material.modeState.changedImageUrl,
      submittedCount: 0,
      correctCount: 0,
    };
    roundPrivate.modeState = {
      answerBox: params.material.modeState.answerBox,
      changeSummary: params.material.modeState.changeSummary,
      submissionsByUid: {},
    };
  } else if (params.room.settings.gameMode === "impostor") {
    const players = sortPlayersBySeatOrder(Object.values(params.state.players));
    const assignment = chooseImpostorAssignments(players);

    round.modeState = {
      kind: "impostor",
      phase: "CHAIN",
      turnOrder: assignment.turnOrder,
      currentTurnIndex: 0,
      currentTurnUid: assignment.turnOrder[0] ?? null,
      chainImageUrl: params.material.targetImageUrl,
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
      players: params.state.players,
      round: round as RoundPublicDoc & { modeState: ImpostorRoundModeState },
      turnSeconds: params.room.settings.roundSeconds,
      startsAt: startedAt,
    });
  }

  params.state.rounds[params.material.roundId] = round;
  params.state.roundPrivates[params.material.roundId] = roundPrivate;

  params.room.status = "IN_ROUND";
  params.room.currentRoundId = params.material.roundId;
  params.room.roundIndex = params.material.roundIndex;
}

export async function ensurePreparedRound(params: {
  roomId: string;
}): Promise<void> {
  const reservation = await withRoomLock(params.roomId, async () => {
    const state = await loadRoomState(params.roomId);
    if (!state) {
      return null;
    }

    const room = requireRoom(state.room);
    syncCpuPlayers(state);

    if (room.status === "FINISHED") {
      if (state.preparedRound) {
        state.preparedRound = null;
        await saveRoomState(bumpRoomVersion(state));
      }
      return null;
    }

    const nextIndex = room.roundIndex + 1;
    if (nextIndex > room.settings.totalRounds) {
      if (state.preparedRound) {
        state.preparedRound = null;
        await saveRoomState(bumpRoomVersion(state));
      }
      return null;
    }

    const currentPrepared = state.preparedRound;
    const hasFreshPreparedRound =
      currentPrepared &&
      currentPrepared.index === nextIndex &&
      (
        currentPrepared.status === "READY" ||
        (currentPrepared.status === "GENERATING" && !isPreparedRoundStale(currentPrepared))
      );

    if (hasFreshPreparedRound) {
      return null;
    }

    const createdAt = new Date();
    const roundId = allocateRoundId(state);
    const expiresAt = dateAfterHours(24);
    state.preparedRound = buildPreparedRoundPlaceholder({
      roundId,
      roundIndex: nextIndex,
      imageModel: room.settings.imageModel,
      createdAt,
    });
    await saveRoomState(bumpRoomVersion(state));

    return {
      roundId,
      roundIndex: nextIndex,
      createdAt,
      expiresAt,
      settings: room.settings,
      excludeStylePresetIds: currentStylePresetIds(state),
    };
  });

  if (!reservation) {
    return;
  }

  try {
    const material: RoundMaterial | null =
      reservation.settings.gameMode === "change"
        ? await buildChangeRoundMaterial({
            roomId: params.roomId,
            roundId: reservation.roundId,
            roundIndex: reservation.roundIndex,
            createdAt: reservation.createdAt,
            expiresAt: reservation.expiresAt,
            settings: reservation.settings,
          })
        : await (async () => {
            const gmPrompt = await generateGmPrompt({
              settings: reservation.settings,
              excludeStylePresetIds: reservation.excludeStylePresetIds,
            });

            if (
              !(await isPreparedRoundReservationActive({
                roomId: params.roomId,
                roundId: reservation.roundId,
                roundIndex: reservation.roundIndex,
              }))
            ) {
              return null;
            }

            const targetImage = await generateImage({
              prompt: gmPrompt.prompt,
              aspectRatio: reservation.settings.aspectRatio,
              imageModel: reservation.settings.imageModel,
            });

            if (
              !(await isPreparedRoundReservationActive({
                roomId: params.roomId,
                roundId: reservation.roundId,
                roundIndex: reservation.roundIndex,
              }))
            ) {
              return null;
            }

            const targetImageUrl = await resolveImageUrl({
              roomId: params.roomId,
              roundId: reservation.roundId,
              subPath: "target.png",
              prompt: gmPrompt.prompt,
              image: targetImage,
            });

            return {
              roundId: reservation.roundId,
              roundIndex: reservation.roundIndex,
              createdAt: reservation.createdAt,
              expiresAt: reservation.expiresAt,
              gmPrompt: gmPrompt.prompt,
              gmTitle: gmPrompt.title,
              gmTags: gmPrompt.tags,
              difficulty: gmPrompt.difficulty as RoundPublicDoc["difficulty"],
              targetImageUrl,
              targetThumbUrl: targetImageUrl,
              stylePresetId: gmPrompt.stylePresetId,
            } satisfies RoundMaterial;
          })();

    if (!material) {
      return;
    }

    await withRoomLock(params.roomId, async () => {
      const state = await loadRoomState(params.roomId);
      if (!state?.preparedRound) {
        return;
      }

      if (
        state.preparedRound.roundId !== reservation.roundId ||
        state.preparedRound.status !== "GENERATING"
      ) {
        return;
      }

      state.preparedRound = {
        ...state.preparedRound,
        status: "READY",
        updatedAt: new Date(),
        gmPrompt: material.gmPrompt,
        gmTitle: material.gmTitle,
        gmTags: material.gmTags,
        difficulty: material.difficulty,
        targetImageUrl: material.targetImageUrl,
        targetThumbUrl: material.targetThumbUrl,
        stylePresetId: material.stylePresetId,
        modeState: material.modeState,
        errorMessage: undefined,
      };

      await saveRoomState(bumpRoomVersion(state));
    });
  } catch (error) {
    console.error("Prepared round generation failed", error);
    const normalized = describeRoundGenerationError(error);

    try {
      await withRoomLock(params.roomId, async () => {
        const state = await loadRoomState(params.roomId);
        if (!state?.preparedRound) {
          return;
        }

        if (state.preparedRound.roundId !== reservation.roundId) {
          return;
        }

        state.preparedRound = {
          ...state.preparedRound,
          status: "FAILED",
          updatedAt: new Date(),
          errorMessage: normalized.message,
        };

        await saveRoomState(bumpRoomVersion(state));
      });
    } catch (cleanupError) {
      console.error("Prepared round cleanup failed", cleanupError);
    }
  }
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
      kind: candidate.kind,
    }));

    const nowMs = Date.now();
    const activePlayers = players.filter(
      (candidate) => !candidate.lastSeenAt || nowMs - candidate.lastSeenAt.getTime() <= 90_000,
    );
    const readyPlayers = activePlayers.length > 0 ? activePlayers : players;
    const minPlayers = room.settings.gameMode === "change" ? CHANGE_MIN_PLAYERS : 1;
    const eligiblePlayers =
      room.settings.gameMode === "change"
        ? readyPlayers.filter((candidate) => candidate.kind === "human")
        : readyPlayers;
    assertCanStartRound(eligiblePlayers, { minPlayers });

    const nextIndex = room.roundIndex + 1;
    if (nextIndex > room.settings.totalRounds) {
      room.status = "FINISHED";
      await saveRoomState(bumpRoomVersion(state!));
      throw new AppError("VALIDATION_ERROR", "All rounds are completed", false, 409);
    }

    const preparedRound = state?.preparedRound;
    if (preparedRound && preparedRound.index !== nextIndex) {
      state!.preparedRound = null;
    }

    if (
      preparedRound &&
      preparedRound.index === nextIndex &&
      preparedRound.status === "READY"
    ) {
      assertRoomTransition(room.status, "IN_ROUND");
      applyMaterializedRound({
        state: state!,
        room,
        material: toRoundMaterialFromPrepared(preparedRound),
      });
      state!.preparedRound = null;
      await saveRoomState(bumpRoomVersion(state!));

      return {
        kind: "prepared" as const,
        roundId: preparedRound.roundId,
        roundIndex: nextIndex,
        settings: room.settings,
      };
    }

    if (
      preparedRound &&
      preparedRound.index === nextIndex &&
      preparedRound.status === "GENERATING" &&
      !isPreparedRoundStale(preparedRound)
    ) {
      return {
        kind: "waiting-prepared" as const,
        roundId: preparedRound.roundId,
        roundIndex: nextIndex,
        settings: room.settings,
      };
    }

    const nextReservation = reserveSynchronousRoundStartInState({
      state: state!,
      room,
      expectedRoundIndex: nextIndex,
    });
    await saveRoomState(bumpRoomVersion(state!));

    return nextReservation;
  });

  if (reservation.kind === "prepared") {
    if (reservation.settings.gameMode === "impostor") {
      await continueImpostorCpuTurns({
        roomId: params.roomId,
        roundId: reservation.roundId,
        scheduleCpuTurns: params.scheduleCpuTurns,
      });
    }

    return {
      roundId: reservation.roundId,
      roundIndex: reservation.roundIndex,
    };
  }

  if (reservation.kind === "waiting-prepared") {
    const preparedRound = await waitForPreparedRound({
      roomId: params.roomId,
      roundId: reservation.roundId,
      roundIndex: reservation.roundIndex,
    });

    if (preparedRound?.status === "READY") {
      const materialized = await withRoomLock(params.roomId, async () => {
        const state = await loadRoomState(params.roomId);
        const room = requireRoom(state?.room);

        if (
          room.status === "IN_ROUND" &&
          room.currentRoundId === reservation.roundId &&
          room.roundIndex === reservation.roundIndex
        ) {
          return {
            roundId: reservation.roundId,
            roundIndex: reservation.roundIndex,
          };
        }

        const latestPrepared = state?.preparedRound;
        const nextIndex = room.roundIndex + 1;

        if (
          latestPrepared &&
          latestPrepared.roundId === reservation.roundId &&
          latestPrepared.index === nextIndex &&
          latestPrepared.status === "READY"
        ) {
          assertRoomTransition(room.status, "IN_ROUND");
          applyMaterializedRound({
            state: state!,
            room,
            material: toRoundMaterialFromPrepared(latestPrepared),
          });
          state!.preparedRound = null;
          await saveRoomState(bumpRoomVersion(state!));

          return {
            roundId: latestPrepared.roundId,
            roundIndex: latestPrepared.index,
          };
        }

        return null;
      });

      if (materialized) {
        if (reservation.settings.gameMode === "impostor") {
          await continueImpostorCpuTurns({
            roomId: params.roomId,
            roundId: materialized.roundId,
            scheduleCpuTurns: params.scheduleCpuTurns,
          });
        }

        return materialized;
      }
    }

    const nextReservation = await reserveSynchronousRoundStart({
      roomId: params.roomId,
      expectedRoundIndex: reservation.roundIndex,
    });

    return startRoundWithReservedGeneration({
      reservation: nextReservation,
      roomId: params.roomId,
      scheduleCpuTurns: params.scheduleCpuTurns,
    });
  }

  return startRoundWithReservedGeneration({
    reservation,
    roomId: params.roomId,
    scheduleCpuTurns: params.scheduleCpuTurns,
  });
}

async function startRoundWithReservedGeneration(params: {
  reservation: {
    kind: "reserved";
    previousStatus: RoomStatus;
    previousRoundId: string | null;
    previousRoundIndex: number;
    roundId: string;
    roundIndex: number;
    settings: RoomState["room"]["settings"];
    expiresAt: Date;
    createdAt: Date;
    excludeStylePresetIds: string[];
  };
  roomId: string;
  scheduleCpuTurns?: CpuTurnScheduler;
}): Promise<{ roundId: string; roundIndex: number }> {
  const reservation = params.reservation;

  try {
    const material: RoundMaterial =
      reservation.settings.gameMode === "change"
        ? await buildChangeRoundMaterial({
            roomId: params.roomId,
            roundId: reservation.roundId,
            roundIndex: reservation.roundIndex,
            createdAt: reservation.createdAt,
            expiresAt: reservation.expiresAt,
            settings: reservation.settings,
          })
        : await (async () => {
            const gmPrompt = await generateGmPrompt({
              settings: reservation.settings,
              excludeStylePresetIds: reservation.excludeStylePresetIds,
            });
            const targetImage = await generateImage({
              prompt: gmPrompt.prompt,
              aspectRatio: reservation.settings.aspectRatio,
              imageModel: reservation.settings.imageModel,
            });

            const targetImageUrl = await resolveImageUrl({
              roomId: params.roomId,
              roundId: reservation.roundId,
              subPath: "target.png",
              prompt: gmPrompt.prompt,
              image: targetImage,
            });

            return {
              roundId: reservation.roundId,
              roundIndex: reservation.roundIndex,
              createdAt: reservation.createdAt,
              expiresAt: reservation.expiresAt,
              gmPrompt: gmPrompt.prompt,
              gmTitle: gmPrompt.title,
              gmTags: gmPrompt.tags,
              difficulty: gmPrompt.difficulty as RoundPublicDoc["difficulty"],
              targetImageUrl,
              targetThumbUrl: targetImageUrl,
              stylePresetId: gmPrompt.stylePresetId,
            } satisfies RoundMaterial;
          })();

    await withRoomLock(params.roomId, async () => {
      const state = await loadRoomState(params.roomId);
      const room = requireRoom(state?.room);
      if (
        room.status !== "GENERATING_ROUND" ||
        room.currentRoundId !== reservation.roundId
      ) {
        throw new AppError("ROUND_CLOSED", "Round generation state was replaced", false, 409);
      }
      assertRoomTransition("GENERATING_ROUND", "IN_ROUND");
      applyMaterializedRound({
        state: state!,
        room,
        material: {
          ...material,
        },
      });
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
    const normalized = describeRoundGenerationError(error);

    try {
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
    } catch (cleanupError) {
      console.error("Round generation cleanup failed", cleanupError);
    }

    throw normalized;
  }
}

async function finalizeClassicResultsIfNeeded(params: {
  roomId: string;
  roundId: string;
}): Promise<{ status: "IN_ROUND" | "RESULTS" }> {
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
      return {
        status: latestRoom.status === "RESULTS" ? "RESULTS" : "IN_ROUND",
      };
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

async function finalizeChangeResultsIfNeeded(params: {
  roomId: string;
  roundId: string;
}): Promise<{ status: "IN_ROUND" | "RESULTS" }> {
  return withRoomLock(params.roomId, async () => {
    const latestState = await loadRoomState(params.roomId);
    const latestRoom = requireRoom(latestState?.room);
    const validated = requireChangeRoundState(
      latestState?.rounds[params.roundId],
      latestState?.roundPrivates[params.roundId],
    );

    if (
      latestRoom.status !== "IN_ROUND" ||
      validated.round.status !== "IN_ROUND" ||
      latestRoom.currentRoundId !== params.roundId
    ) {
      return {
        status: latestRoom.status === "RESULTS" ? "RESULTS" : "IN_ROUND",
      };
    }

    const endsAt = parseDate(validated.round.endsAt);
    if (!endsAt) {
      return { status: "IN_ROUND" };
    }

    syncChangeRoundStats({
      round: validated.round,
      roundPrivate: validated.roundPrivate,
    });

    const humanCount = listHumanPlayers(latestState!.players).length;
    const everyoneSubmitted =
      humanCount > 0 &&
      validated.round.modeState.submittedCount >= humanCount;
    const now = Date.now();
    const submissionDeadline = getRoundSubmissionDeadline({
      promptStartsAt: validated.round.promptStartsAt,
      roundSeconds: latestRoom.settings.roundSeconds,
    });
    const isGraceWindow = Boolean(
      submissionDeadline && endsAt.getTime() > submissionDeadline.getTime(),
    );
    const isShortenedResultsCountdown = Boolean(
      submissionDeadline && endsAt.getTime() < submissionDeadline.getTime(),
    );

    if (
      everyoneSubmitted &&
      submissionDeadline &&
      !isGraceWindow &&
      !isShortenedResultsCountdown &&
      now < endsAt.getTime()
    ) {
      validated.round.endsAt = new Date(now + RESULTS_GRACE_SECONDS * 1000);
      await saveRoomState(bumpRoomVersion(latestState!));
      return { status: "IN_ROUND" };
    }

    if (
      submissionDeadline &&
      now >= submissionDeadline.getTime() &&
      !isGraceWindow &&
      !isShortenedResultsCountdown
    ) {
      validated.round.endsAt = new Date(now + RESULTS_GRACE_SECONDS * 1000);
      await saveRoomState(bumpRoomVersion(latestState!));
      return { status: "IN_ROUND" };
    }

    if (now < endsAt.getTime()) {
      return { status: "IN_ROUND" };
    }

    validated.round.status = "RESULTS";
    validated.round.reveal = {
      answerBox: validated.roundPrivate.modeState.answerBox,
      changeSummary: validated.roundPrivate.modeState.changeSummary,
    };
    latestRoom.status = "RESULTS";

    await saveRoomState(bumpRoomVersion(latestState!));
    return { status: "RESULTS" };
  });
}

async function maybeConsumeClassicTimeoutDraft(params: {
  roomId: string;
  roundId: string;
  uid?: string;
  draftPrompt?: string;
  language?: Language;
}): Promise<{ status: "IN_ROUND" | "RESULTS"; consumedDraft?: boolean } | null> {
  const uid = params.uid?.trim();
  const prompt = params.draftPrompt?.trim() ?? "";

  if (!uid || prompt.length === 0) {
    return null;
  }

  return withSubmitLock(params.roomId, params.roundId, uid, async () => {
    const submitStartedAt = new Date();
    let reservedAttempt: ReturnType<
      typeof reserveClassicRoundAttemptInState
    > | null = null;

    await withRoomLock(params.roomId, async () => {
      const latestState = await loadRoomState(params.roomId);
      const latestRoom = requireRoom(latestState?.room);
      const latestRound = latestState?.rounds[params.roundId];

      if (!latestState || !latestRound || !latestState.players[uid]) {
        return;
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
        return;
      }

      if (hasScoringAttempts(latestState.attempts[params.roundId])) {
        return;
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
        !submissionDeadline ||
        now < submissionDeadline.getTime() ||
        isGraceWindow ||
        isShortenedResultsCountdown
      ) {
        return;
      }

      const playerAttempts = latestState.attempts[params.roundId]?.[uid];
      if (
        (playerAttempts?.attemptsUsed ?? 0) >= latestRoom.settings.maxAttempts
      ) {
        return;
      }

      reservedAttempt = reserveClassicRoundAttemptInState({
        state: latestState,
        roomId: params.roomId,
        roundId: params.roundId,
        uid,
        prompt,
        submitStartedAt,
        mode: "timeout",
      });
      await saveRoomState(bumpRoomVersion(latestState));
    });

    if (!reservedAttempt) {
      return null;
    }

    try {
      await submitClassicRoundAttemptWithReservation({
        roomId: params.roomId,
        roundId: params.roundId,
        uid,
        prompt,
        language: params.language ?? DEFAULT_LANGUAGE,
        submitStartedAt,
        reservedAttempt,
        mode: "timeout",
        logStageFailure: (stage, context, error) => {
          console.error("timeout draft auto-submit failed", {
            stage,
            roomId: context.roomId,
            roundId: context.roundId,
            uid: context.uid,
            promptPreview: context.prompt.slice(0, 120),
            error: summarizeTimeoutAutoSubmitError(error),
          });
        },
      });

      return { status: "IN_ROUND", consumedDraft: true };
    } catch (error) {
      console.error("timeout draft auto-submit failed", {
        roomId: params.roomId,
        roundId: params.roundId,
        uid,
        promptPreview: prompt.slice(0, 120),
        error: summarizeTimeoutAutoSubmitError(error),
      });

      return finalizeClassicResultsIfNeeded({
        roomId: params.roomId,
        roundId: params.roundId,
      });
    }
  });
}

export async function endRoundIfNeeded(params: {
  roomId: string;
  roundId: string;
  uid?: string;
  draftPrompt?: string;
  language?: Language;
  scheduleCpuTurns?: CpuTurnScheduler;
}): Promise<{ status: "IN_ROUND" | "RESULTS"; consumedDraft?: boolean }> {
  const state = await loadRoomState(params.roomId);
  const room = requireRoom(state?.room);
  const roundDoc = state?.rounds[params.roundId];

  if (!roundDoc) {
    throw new AppError("ROUND_NOT_FOUND", "Round does not exist", false, 404);
  }

  if (room.settings.gameMode === "change" && roundDoc.modeState?.kind === "change") {
    return finalizeChangeResultsIfNeeded({
      roomId: params.roomId,
      roundId: params.roundId,
    });
  }

  if (room.settings.gameMode !== "impostor" || roundDoc.modeState?.kind !== "impostor") {
    const timeoutDraftResult = await maybeConsumeClassicTimeoutDraft({
      roomId: params.roomId,
      roundId: params.roundId,
      uid: params.uid,
      draftPrompt: params.draftPrompt,
      language: params.language,
    });

    if (timeoutDraftResult) {
      return timeoutDraftResult;
    }

    return finalizeClassicResultsIfNeeded({
      roomId: params.roomId,
      roundId: params.roundId,
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
    submittedPrompt:
      player.kind === "human" && params.uid === player.uid
        ? params.draftPrompt?.trim() || undefined
        : undefined,
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
    ...(player.kind === "human" &&
    params.uid === player.uid &&
    (params.draftPrompt?.trim() ?? "").length > 0
      ? { consumedDraft: true }
      : {}),
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
    state.preparedRound = null;
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
