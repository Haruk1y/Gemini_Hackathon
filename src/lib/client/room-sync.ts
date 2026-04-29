"use client";

import { useEffect, useMemo, useState } from "react";
import { buildCurrentApiPath } from "@/lib/client/paths";
import {
  normalizeImageModel,
  normalizeTextModelVariant,
  type PreparedRoundStatus,
  type ErrorCode,
  type GameMode,
  type ImageModel,
  type ImpostorRole,
  type PlayerKind,
  type TextModelVariant,
} from "@/lib/types/game";

export type RoomStatus =
  | "LOBBY"
  | "GENERATING_ROUND"
  | "IN_ROUND"
  | "RESULTS"
  | "FINISHED";
export type RoundStatus = "GENERATING" | "IN_ROUND" | "RESULTS";
export type ImpostorRoundPhase = "CHAIN" | "VOTING" | "REVEAL";

export interface NormalizedPointData {
  x: number;
  y: number;
}

export interface NormalizedBoxData extends NormalizedPointData {
  width: number;
  height: number;
}

export interface ChangeSubmissionData {
  uid: string;
  displayName: string;
  kind: PlayerKind;
  point: NormalizedPointData;
  hit: boolean;
  score: number;
  rank: number | null;
  createdAt?: unknown;
}

export interface ChangeResultData {
  uid: string;
  displayName: string;
  kind: PlayerKind;
  submitted: boolean;
  point: NormalizedPointData | null;
  hit: boolean;
  score: number;
  rank: number | null;
  createdAt?: unknown;
}

export interface RoomData {
  roomId?: string;
  code?: string;
  status: RoomStatus;
  currentRoundId: string | null;
  roundIndex?: number;
  nextRoundPreparation?: {
    index?: number;
    status?: PreparedRoundStatus;
  } | null;
  settings?: {
    gameMode?: GameMode;
    maxPlayers?: number;
    roundSeconds?: number;
    maxAttempts?: number;
    aspectRatio?: "1:1" | "16:9" | "9:16";
    imageModel?: ImageModel;
    promptModel?: TextModelVariant;
    judgeModel?: TextModelVariant;
    hintLimit?: number;
    totalRounds?: number;
    cpuCount?: number;
  };
}

export interface PlayerData {
  uid: string;
  displayName: string;
  kind: PlayerKind;
  ready: boolean;
  isHost: boolean;
  totalScore: number;
}

export interface RoundData {
  roundId: string;
  index: number;
  status: RoundStatus;
  targetImageUrl?: string;
  targetThumbUrl?: string;
  gmTitle: string;
  promptStartsAt?: unknown;
  gmTags?: string[];
  reveal?: {
    gmPromptPublic?: string;
    answerBox?: NormalizedBoxData;
    changeSummary?: string;
  };
  endsAt: unknown;
  stats?: {
    submissions?: number;
    topScore?: number;
  };
  difficulty?: 1 | 2 | 3 | 4 | 5;
  modeState?: {
    kind?: "impostor" | "change";
    baseImageUrl?: string;
    changedImageUrl?: string;
    submittedCount?: number;
    correctCount?: number;
    phase?: ImpostorRoundPhase;
    turnOrder?: string[];
    currentTurnIndex?: number;
    currentTurnUid?: string | null;
    chainImageUrl?: string;
    similarityThreshold?: number;
    finalSimilarityScore?: number | null;
    voteCount?: number;
    voteTarget?: string | null;
    revealedTurns?: number;
  };
}

export interface ScoreEntry {
  uid: string;
  displayName: string;
  bestScore: number;
  bestImageUrl: string;
  bestPromptPublic?: string;
}

export interface AttemptData {
  attemptsUsed: number;
  hintUsed?: number;
  bestScore: number;
  bestAttemptNo?: number | null;
  attempts: Array<{
    attemptNo: number;
    imageUrl: string;
    score: number | null;
    prompt: string;
    status?: "GENERATING" | "SCORING" | "DONE";
    matchedElements?: string[];
    missingElements?: string[];
    judgeNote?: string;
  }>;
}

export interface TurnTimelineEntry {
  uid: string;
  displayName: string;
  kind: PlayerKind;
  imageUrl: string;
  similarityScore: number;
  matchedElements?: string[];
  missingElements?: string[];
  judgeNote?: string;
  prompt?: string;
  role?: ImpostorRole;
  timedOut?: boolean;
  votedForUid?: string | null;
}

export interface RoomSyncSnapshot {
  room: RoomData | null;
  players: PlayerData[];
  round: RoundData | null;
  scores: ScoreEntry[];
  attempts: AttemptData | null;
  playerCount: number;
  myRole?: ImpostorRole | null;
  isMyTurn?: boolean;
  currentTurnUid?: string | null;
  mySubmission?: ChangeSubmissionData | null;
  voteProgress?: {
    submitted: number;
    total: number;
    meTargetUid?: string | null;
  } | null;
  finalSimilarityScore?: number | null;
  changeResults: ChangeResultData[];
  turnTimeline: TurnTimelineEntry[];
  revealLocked?: boolean;
}

type ConnectionState =
  | "idle"
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed";

export interface RoomSyncErrorInfo {
  code?: ErrorCode;
  message: string;
}

class RoomSyncError extends Error {
  constructor(
    message: string,
    public code?: ErrorCode,
  ) {
    super(message);
    this.name = "RoomSyncError";
  }
}

function normalizeAttemptStatus(
  value: unknown,
): "GENERATING" | "SCORING" | "DONE" | undefined {
  return value === "GENERATING" || value === "SCORING" || value === "DONE"
    ? value
    : undefined;
}

const EMPTY_SNAPSHOT: RoomSyncSnapshot = {
  room: null,
  players: [],
  round: null,
  scores: [],
  attempts: null,
  playerCount: 0,
  myRole: null,
  isMyTurn: false,
  currentTurnUid: null,
  mySubmission: null,
  voteProgress: null,
  finalSimilarityScore: null,
  changeResults: [],
  turnTimeline: [],
  revealLocked: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeRoomStatus(value: unknown): RoomStatus | null {
  return value === "LOBBY" ||
    value === "GENERATING_ROUND" ||
    value === "IN_ROUND" ||
    value === "RESULTS" ||
    value === "FINISHED"
    ? value
    : null;
}

function normalizeRoundStatus(value: unknown): RoundStatus | null {
  return value === "GENERATING" || value === "IN_ROUND" || value === "RESULTS"
    ? value
    : null;
}

function normalizeGameMode(value: unknown): GameMode | null {
  return value === "classic" ||
    value === "memory" ||
    value === "change" ||
    value === "impostor"
    ? value
    : null;
}

function normalizePlayerKind(value: unknown): PlayerKind | null {
  return value === "human" || value === "cpu" ? value : null;
}

function normalizeImageModelSetting(value: unknown): ImageModel | null {
  return value === "gemini" || value === "flux" || value === "flash"
    ? normalizeImageModel(value)
    : null;
}

function normalizeTextModelSetting(value: unknown): TextModelVariant | null {
  return value === "flash" || value === "flash-lite" || value === "gemini-2.5-flash" ||
    value === "gemini-2.5-flash-lite"
    ? normalizeTextModelVariant(value)
    : null;
}

function normalizeImpostorRole(value: unknown): ImpostorRole | null {
  return value === "agent" || value === "impostor" ? value : null;
}

function normalizeImpostorPhase(value: unknown): ImpostorRoundPhase | null {
  return value === "CHAIN" || value === "VOTING" || value === "REVEAL"
    ? value
    : null;
}

function normalizeNormalizedPoint(value: unknown): NormalizedPointData | null {
  if (!isRecord(value)) return null;
  const x = asNumber(value.x);
  const y = asNumber(value.y);
  if (x == null || y == null) return null;

  return { x, y };
}

function normalizeNormalizedBox(value: unknown): NormalizedBoxData | null {
  if (!isRecord(value)) return null;
  const point = normalizeNormalizedPoint(value);
  const width = asNumber(value.width);
  const height = asNumber(value.height);
  if (!point || width == null || height == null) return null;

  return {
    ...point,
    width,
    height,
  };
}

function normalizeChangeSubmission(value: unknown): ChangeSubmissionData | null {
  if (!isRecord(value)) return null;
  const uid = asString(value.uid);
  const displayName = asString(value.displayName);
  const point = normalizeNormalizedPoint(value.point);
  if (!uid || !displayName || !point) return null;

  return {
    uid,
    displayName,
    kind: normalizePlayerKind(value.kind) ?? "human",
    point,
    hit: Boolean(value.hit),
    score: asNumber(value.score) ?? 0,
    rank:
      typeof value.rank === "number"
        ? value.rank
        : value.rank === null
          ? null
          : null,
    createdAt: value.createdAt ?? undefined,
  };
}

function normalizeChangeResults(value: unknown): ChangeResultData[] {
  if (!Array.isArray(value)) return [];

  const results: ChangeResultData[] = [];

  for (const rawEntry of value) {
    if (!isRecord(rawEntry)) continue;

    const uid = asString(rawEntry.uid);
    const displayName = asString(rawEntry.displayName);
    if (!uid || !displayName) continue;

    const point =
      rawEntry.point === null
        ? null
        : normalizeNormalizedPoint(rawEntry.point);
    if (rawEntry.point !== null && !point) continue;

    results.push({
      uid,
      displayName,
      kind: normalizePlayerKind(rawEntry.kind) ?? "human",
      submitted: Boolean(rawEntry.submitted),
      point,
      hit: Boolean(rawEntry.hit),
      score: asNumber(rawEntry.score) ?? 0,
      rank:
        typeof rawEntry.rank === "number"
          ? rawEntry.rank
          : rawEntry.rank === null
            ? null
            : null,
      createdAt: rawEntry.createdAt ?? undefined,
    });
  }

  return results;
}

function normalizeRoomData(value: unknown): RoomData | null {
  if (!isRecord(value)) return null;
  const status = normalizeRoomStatus(value.status);
  if (!status) return null;

  return {
    roomId: asString(value.roomId) ?? undefined,
    code: asString(value.code) ?? undefined,
    status,
    currentRoundId: asString(value.currentRoundId),
    roundIndex: asNumber(value.roundIndex) ?? undefined,
    nextRoundPreparation: isRecord(value.nextRoundPreparation)
      ? {
          index: asNumber(value.nextRoundPreparation.index) ?? undefined,
          status:
            value.nextRoundPreparation.status === "GENERATING" ||
            value.nextRoundPreparation.status === "READY" ||
            value.nextRoundPreparation.status === "FAILED"
              ? value.nextRoundPreparation.status
              : undefined,
        }
      : value.nextRoundPreparation === null
        ? null
        : undefined,
    settings: isRecord(value.settings)
      ? {
          gameMode: normalizeGameMode(value.settings.gameMode) ?? undefined,
          maxPlayers: asNumber(value.settings.maxPlayers) ?? undefined,
          roundSeconds: asNumber(value.settings.roundSeconds) ?? undefined,
          maxAttempts: asNumber(value.settings.maxAttempts) ?? undefined,
          aspectRatio:
            value.settings.aspectRatio === "1:1" ||
            value.settings.aspectRatio === "16:9" ||
            value.settings.aspectRatio === "9:16"
              ? value.settings.aspectRatio
              : undefined,
          imageModel:
            normalizeImageModelSetting(value.settings.imageModel) ?? undefined,
          promptModel:
            normalizeTextModelSetting(value.settings.promptModel) ?? undefined,
          judgeModel:
            normalizeTextModelSetting(value.settings.judgeModel) ?? undefined,
          hintLimit: asNumber(value.settings.hintLimit) ?? undefined,
          totalRounds: asNumber(value.settings.totalRounds) ?? undefined,
          cpuCount: asNumber(value.settings.cpuCount) ?? undefined,
        }
      : undefined,
  };
}

function normalizePlayers(value: unknown): PlayerData[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((player) => ({
      uid: asString(player.uid) ?? "",
      displayName: asString(player.displayName) ?? "",
      kind: normalizePlayerKind(player.kind) ?? "human",
      ready: Boolean(player.ready),
      isHost: Boolean(player.isHost),
      totalScore: asNumber(player.totalScore) ?? 0,
    }))
    .filter((player) => player.uid.length > 0);
}

function normalizeRoundData(value: unknown): RoundData | null {
  if (!isRecord(value)) return null;
  const status = normalizeRoundStatus(value.status);
  const roundId = asString(value.roundId);
  const index = asNumber(value.index);
  const gmTitle = asString(value.gmTitle);
  if (!status || !roundId || index == null || !gmTitle) return null;

  return {
    roundId,
    index,
    status,
    targetImageUrl:
      typeof value.targetImageUrl === "string"
        ? value.targetImageUrl
        : undefined,
    targetThumbUrl:
      typeof value.targetThumbUrl === "string"
        ? value.targetThumbUrl
        : undefined,
    gmTitle,
    promptStartsAt: value.promptStartsAt ?? null,
    gmTags: Array.isArray(value.gmTags)
      ? value.gmTags.filter((tag): tag is string => typeof tag === "string")
      : undefined,
    reveal: isRecord(value.reveal)
      ? {
          gmPromptPublic: asString(value.reveal.gmPromptPublic) ?? undefined,
          answerBox:
            normalizeNormalizedBox(value.reveal.answerBox) ?? undefined,
          changeSummary: asString(value.reveal.changeSummary) ?? undefined,
        }
      : undefined,
    endsAt: value.endsAt ?? null,
    stats: isRecord(value.stats)
      ? {
          submissions: asNumber(value.stats.submissions) ?? undefined,
          topScore: asNumber(value.stats.topScore) ?? undefined,
        }
      : undefined,
    difficulty:
      value.difficulty === 1 ||
      value.difficulty === 2 ||
      value.difficulty === 3 ||
      value.difficulty === 4 ||
      value.difficulty === 5
        ? value.difficulty
        : undefined,
    modeState: isRecord(value.modeState)
      ? {
          kind:
            value.modeState.kind === "impostor" ||
            value.modeState.kind === "change"
              ? value.modeState.kind
              : undefined,
          baseImageUrl: asString(value.modeState.baseImageUrl) ?? undefined,
          changedImageUrl:
            asString(value.modeState.changedImageUrl) ?? undefined,
          submittedCount: asNumber(value.modeState.submittedCount) ?? undefined,
          correctCount: asNumber(value.modeState.correctCount) ?? undefined,
          phase: normalizeImpostorPhase(value.modeState.phase) ?? undefined,
          turnOrder: Array.isArray(value.modeState.turnOrder)
            ? value.modeState.turnOrder.filter(
                (item): item is string => typeof item === "string",
              )
            : undefined,
          currentTurnIndex:
            asNumber(value.modeState.currentTurnIndex) ?? undefined,
          currentTurnUid: asString(value.modeState.currentTurnUid),
          chainImageUrl: asString(value.modeState.chainImageUrl) ?? undefined,
          similarityThreshold:
            asNumber(value.modeState.similarityThreshold) ?? undefined,
          finalSimilarityScore:
            typeof value.modeState.finalSimilarityScore === "number"
              ? value.modeState.finalSimilarityScore
              : value.modeState.finalSimilarityScore === null
                ? null
                : undefined,
          voteCount: asNumber(value.modeState.voteCount) ?? undefined,
          voteTarget: asString(value.modeState.voteTarget),
          revealedTurns: asNumber(value.modeState.revealedTurns) ?? undefined,
        }
      : undefined,
  };
}

function normalizeScores(value: unknown): ScoreEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((entry) => ({
      uid: asString(entry.uid) ?? "",
      displayName: asString(entry.displayName) ?? "",
      bestScore: asNumber(entry.bestScore) ?? 0,
      bestImageUrl: asString(entry.bestImageUrl) ?? "",
      bestPromptPublic: asString(entry.bestPromptPublic) ?? undefined,
    }))
    .filter((entry) => entry.uid.length > 0);
}

function normalizeAttempts(value: unknown): AttemptData | null {
  if (!isRecord(value)) return null;
  const attemptsUsed = asNumber(value.attemptsUsed);
  const bestScore = asNumber(value.bestScore);
  if (attemptsUsed == null || bestScore == null) return null;

  return {
    attemptsUsed,
    hintUsed: asNumber(value.hintUsed) ?? undefined,
    bestScore,
    bestAttemptNo: asNumber(value.bestAttemptNo) ?? null,
    attempts: Array.isArray(value.attempts)
      ? value.attempts
          .filter(isRecord)
          .map((attempt) => ({
            attemptNo: asNumber(attempt.attemptNo) ?? 0,
            imageUrl: asString(attempt.imageUrl) ?? "",
            score: typeof attempt.score === "number" ? attempt.score : null,
            prompt: asString(attempt.prompt) ?? "",
            status: normalizeAttemptStatus(attempt.status),
            matchedElements: Array.isArray(attempt.matchedElements)
              ? attempt.matchedElements.filter(
                  (item): item is string => typeof item === "string",
                )
              : undefined,
            missingElements: Array.isArray(attempt.missingElements)
              ? attempt.missingElements.filter(
                  (item): item is string => typeof item === "string",
                )
              : undefined,
            judgeNote: asString(attempt.judgeNote) ?? undefined,
          }))
          .filter((attempt) => attempt.attemptNo > 0)
      : [],
  };
}

function normalizeVoteProgress(value: unknown) {
  if (!isRecord(value)) return null;
  const submitted = asNumber(value.submitted);
  const total = asNumber(value.total);
  if (submitted == null || total == null) return null;

  return {
    submitted,
    total,
    meTargetUid: asString(value.meTargetUid),
  };
}

function normalizeTurnTimeline(value: unknown): TurnTimelineEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((entry) => ({
      uid: asString(entry.uid) ?? "",
      displayName: asString(entry.displayName) ?? "",
      kind: normalizePlayerKind(entry.kind) ?? "human",
      imageUrl: asString(entry.imageUrl) ?? "",
      similarityScore: asNumber(entry.similarityScore) ?? 0,
      matchedElements: Array.isArray(entry.matchedElements)
        ? entry.matchedElements.filter(
            (item): item is string => typeof item === "string",
          )
        : undefined,
      missingElements: Array.isArray(entry.missingElements)
        ? entry.missingElements.filter(
            (item): item is string => typeof item === "string",
          )
        : undefined,
      judgeNote: asString(entry.judgeNote) ?? undefined,
      prompt: asString(entry.prompt) ?? undefined,
      role: normalizeImpostorRole(entry.role) ?? undefined,
      timedOut:
        typeof entry.timedOut === "boolean" ? entry.timedOut : undefined,
      votedForUid: asString(entry.votedForUid),
    }))
    .filter((entry) => entry.uid.length > 0);
}

export function normalizeSnapshot(value: unknown): RoomSyncSnapshot {
  if (!isRecord(value)) {
    return { ...EMPTY_SNAPSHOT };
  }

  const room = normalizeRoomData(
    value.room ?? value.roomData ?? value.currentRoom ?? value,
  );
  const players = normalizePlayers(value.players);
  const round = normalizeRoundData(
    value.round ?? value.roundData ?? value.currentRound,
  );
  const scores = normalizeScores(value.scores);
  const attempts = normalizeAttempts(
    value.attempts ?? value.attemptsData ?? value.myAttempts,
  );

  return {
    room,
    players,
    round,
    scores,
    attempts,
    playerCount: asNumber(value.playerCount) ?? players.length,
    myRole: normalizeImpostorRole(value.myRole),
    isMyTurn: Boolean(value.isMyTurn),
    currentTurnUid: asString(value.currentTurnUid),
    mySubmission: normalizeChangeSubmission(value.mySubmission),
    voteProgress: normalizeVoteProgress(value.voteProgress),
    finalSimilarityScore:
      typeof value.finalSimilarityScore === "number"
        ? value.finalSimilarityScore
        : value.finalSimilarityScore === null
          ? null
          : undefined,
    changeResults: normalizeChangeResults(value.changeResults),
    turnTimeline: normalizeTurnTimeline(value.turnTimeline),
    revealLocked:
      typeof value.revealLocked === "boolean" ? value.revealLocked : undefined,
  };
}

export function useRoomSync(params: {
  roomId: string;
  view: "lobby" | "round" | "results" | "transition";
  enabled?: boolean;
}) {
  const enabled = params.enabled ?? true;
  const [snapshot, setSnapshot] = useState<RoomSyncSnapshot>(EMPTY_SNAPSHOT);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("idle");
  const [error, setError] = useState<RoomSyncErrorInfo | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      return;
    }

    let disposed = false;
    let timerId: number | null = null;
    let version = -1;
    const intervalMs = 1000;

    const poll = async () => {
      const controller = new AbortController();
      try {
        const response = await fetch(
          buildCurrentApiPath(
            `/api/rooms/${encodeURIComponent(params.roomId)}/snapshot?view=${encodeURIComponent(
              params.view,
            )}&since=${encodeURIComponent(String(version))}`,
          ),
          {
            credentials: "include",
            cache: "no-store",
            signal: controller.signal,
          },
        );

        if (disposed) return;

        if (response.status === 204) {
          setConnectionState("open");
          setError(null);
          return;
        }

        const payload = (await response.json().catch(() => null)) as {
          ok?: boolean;
          version?: unknown;
          snapshot?: unknown;
          error?: {
            code?: unknown;
            message?: unknown;
          };
        } | null;

        if (!response.ok || !payload?.ok) {
          throw new RoomSyncError(
            typeof payload?.error?.message === "string"
              ? payload.error.message
              : "snapshot polling failed",
            typeof payload?.error?.code === "string"
              ? (payload.error.code as ErrorCode)
              : undefined,
          );
        }

        version =
          typeof payload.version === "number" ? payload.version : version;
        setSnapshot(normalizeSnapshot(payload.snapshot));
        setConnectionState("open");
        setError(null);
      } catch (pollError) {
        if (disposed) return;
        setConnectionState((current) =>
          current === "open" ? "reconnecting" : "connecting",
        );
        if (pollError instanceof RoomSyncError) {
          setError({
            code: pollError.code,
            message: pollError.message,
          });
          return;
        }

        setError({
          message:
            pollError instanceof Error ? pollError.message : "reconnecting",
        });
      } finally {
        if (!disposed) {
          timerId = window.setTimeout(() => {
            void poll();
          }, intervalMs);
        }
      }
    };

    setConnectionState("connecting");
    void poll();

    return () => {
      disposed = true;
      if (timerId) {
        window.clearTimeout(timerId);
      }
    };
  }, [enabled, params.roomId, params.view]);

  const derivedConnectionState =
    enabled && connectionState === "idle" ? "connecting" : connectionState;

  return useMemo(
    () => ({
      snapshot,
      connectionState: derivedConnectionState,
      error,
      isConnecting:
        derivedConnectionState === "connecting" ||
        derivedConnectionState === "reconnecting",
      isOpen: derivedConnectionState === "open",
    }),
    [derivedConnectionState, error, snapshot],
  );
}
