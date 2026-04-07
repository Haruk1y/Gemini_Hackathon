"use client";

import { useEffect, useMemo, useState } from "react";
import type { GameMode } from "@/lib/types/game";

export type RoomStatus = "LOBBY" | "GENERATING_ROUND" | "IN_ROUND" | "RESULTS" | "FINISHED";
export type RoundStatus = "GENERATING" | "IN_ROUND" | "RESULTS";

export interface RoomData {
  roomId?: string;
  code?: string;
  status: RoomStatus;
  currentRoundId: string | null;
  roundIndex?: number;
  settings?: {
    gameMode?: GameMode;
    maxPlayers?: number;
    roundSeconds?: number;
    maxAttempts?: number;
    aspectRatio?: "1:1" | "16:9" | "9:16";
    hintLimit?: number;
    totalRounds?: number;
  };
}

export interface PlayerData {
  uid: string;
  displayName: string;
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
    targetCaption?: string;
    gmPromptPublic?: string;
  };
  endsAt: unknown;
  stats?: {
    submissions?: number;
    topScore?: number;
  };
  difficulty?: 1 | 2 | 3 | 4 | 5;
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
    captionText?: string;
    status?: "SCORING" | "DONE";
    matchedElements?: string[];
    missingElements?: string[];
    judgeNote?: string;
  }>;
}

export interface RoomSyncSnapshot {
  room: RoomData | null;
  players: PlayerData[];
  round: RoundData | null;
  scores: ScoreEntry[];
  attempts: AttemptData | null;
  playerCount: number;
}

type ConnectionState = "idle" | "connecting" | "open" | "reconnecting" | "closed";

function normalizeAttemptStatus(value: unknown): "SCORING" | "DONE" | undefined {
  return value === "SCORING" || value === "DONE" ? value : undefined;
}

const EMPTY_SNAPSHOT: RoomSyncSnapshot = {
  room: null,
  players: [],
  round: null,
  scores: [],
  attempts: null,
  playerCount: 0,
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
  return value === "GENERATING" || value === "IN_ROUND" || value === "RESULTS" ? value : null;
}

function normalizeGameMode(value: unknown): GameMode | null {
  return value === "classic" || value === "memory" ? value : null;
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
          hintLimit: asNumber(value.settings.hintLimit) ?? undefined,
          totalRounds: asNumber(value.settings.totalRounds) ?? undefined,
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
    targetImageUrl: typeof value.targetImageUrl === "string" ? value.targetImageUrl : undefined,
    targetThumbUrl: typeof value.targetThumbUrl === "string" ? value.targetThumbUrl : undefined,
    gmTitle,
    promptStartsAt: value.promptStartsAt ?? null,
    gmTags: Array.isArray(value.gmTags)
      ? value.gmTags.filter((tag): tag is string => typeof tag === "string")
      : undefined,
    reveal: isRecord(value.reveal)
      ? {
          targetCaption: asString(value.reveal.targetCaption) ?? undefined,
          gmPromptPublic: asString(value.reveal.gmPromptPublic) ?? undefined,
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
            captionText: asString(attempt.captionText) ?? undefined,
            status: normalizeAttemptStatus(attempt.status),
            matchedElements: Array.isArray(attempt.matchedElements)
              ? attempt.matchedElements.filter((item): item is string => typeof item === "string")
              : undefined,
            missingElements: Array.isArray(attempt.missingElements)
              ? attempt.missingElements.filter((item): item is string => typeof item === "string")
              : undefined,
            judgeNote: asString(attempt.judgeNote) ?? undefined,
          }))
          .filter((attempt) => attempt.attemptNo > 0)
      : [],
  };
}

export function normalizeSnapshot(value: unknown): RoomSyncSnapshot {
  if (!isRecord(value)) {
    return { ...EMPTY_SNAPSHOT };
  }

  const room = normalizeRoomData(value.room ?? value.roomData ?? value.currentRoom ?? value);
  const players = normalizePlayers(value.players);
  const round = normalizeRoundData(value.round ?? value.roundData ?? value.currentRound);
  const scores = normalizeScores(value.scores);
  const attempts = normalizeAttempts(value.attempts ?? value.attemptsData ?? value.myAttempts);

  return {
    room,
    players,
    round,
    scores,
    attempts,
    playerCount:
      asNumber(value.playerCount) ?? players.length,
  };
}

function mergeSnapshots(current: RoomSyncSnapshot, patch: RoomSyncSnapshot): RoomSyncSnapshot {
  return {
    room: patch.room ?? current.room,
    players: patch.players.length > 0 ? patch.players : current.players,
    round: patch.round ?? current.round,
    scores: patch.scores.length > 0 ? patch.scores : current.scores,
    attempts: patch.attempts ?? current.attempts,
    playerCount:
      patch.playerCount ?? current.playerCount ?? patch.players.length ?? current.players.length,
  };
}

function parsePayload(data: string): unknown {
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return { message: data };
  }
}

export function useRoomSync(params: {
  roomId: string;
  view: "lobby" | "round" | "results" | "transition";
  enabled?: boolean;
}) {
  const enabled = params.enabled ?? true;
  const [snapshot, setSnapshot] = useState<RoomSyncSnapshot>(EMPTY_SNAPSHOT);
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      return;
    }

    const url = `/api/rooms/${encodeURIComponent(params.roomId)}/events?view=${encodeURIComponent(
      params.view,
    )}`;
    const eventSource = new EventSource(url, { withCredentials: true });
    let disposed = false;

    const applySnapshot = (value: unknown, replace = false) => {
      if (disposed) return;
      const normalized = normalizeSnapshot(value);
      setSnapshot((current) => (replace ? normalized : mergeSnapshots(current, normalized)));
    };

    const handleMessage = (event: MessageEvent<string>) => {
      const payload = parsePayload(event.data);
      if (!payload) return;

      if (isRecord(payload) && payload.type === "snapshot") {
        applySnapshot(payload.snapshot ?? payload.data ?? payload, true);
        return;
      }

      if (isRecord(payload) && payload.type === "patch") {
        applySnapshot(payload.patch ?? payload.data ?? payload, false);
        return;
      }

      applySnapshot(payload, false);
    };

    const handleNamedEvent = (event: MessageEvent<string>) => {
      const payload = parsePayload(event.data);
      if (!payload) return;

      if (event.type === "snapshot") {
        applySnapshot(payload, true);
        return;
      }

      if (event.type === "patch" || event.type === "room" || event.type === "players" || event.type === "round" || event.type === "scores" || event.type === "attempts") {
        applySnapshot({ [event.type]: payload }, false);
        return;
      }

      handleMessage(event);
    };

    eventSource.onopen = () => {
      if (!disposed) {
        setConnectionState("open");
        setError(null);
      }
    };

    eventSource.onmessage = handleMessage;
    eventSource.addEventListener("snapshot", handleNamedEvent as EventListener);
    eventSource.addEventListener("patch", handleNamedEvent as EventListener);
    eventSource.addEventListener("room", handleNamedEvent as EventListener);
    eventSource.addEventListener("players", handleNamedEvent as EventListener);
    eventSource.addEventListener("round", handleNamedEvent as EventListener);
    eventSource.addEventListener("scores", handleNamedEvent as EventListener);
    eventSource.addEventListener("attempts", handleNamedEvent as EventListener);

    eventSource.onerror = () => {
      if (!disposed) {
        setConnectionState((current) => (current === "open" ? "reconnecting" : "connecting"));
        setError("reconnecting");
      }
    };

    return () => {
      disposed = true;
      eventSource.close();
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
        derivedConnectionState === "connecting" || derivedConnectionState === "reconnecting",
      isOpen: derivedConnectionState === "open",
    }),
    [derivedConnectionState, error, snapshot],
  );
}
