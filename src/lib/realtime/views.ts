import { isMemoryPreviewActive } from "@/lib/game/modes";
import type { RoomState } from "@/lib/server/room-state";
import type { GameMode, RoundStatus } from "@/lib/types/game";
import { parseDate } from "@/lib/utils/time";

export type RoomViewName = "lobby" | "round" | "results" | "transition";

function toSerializableDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return value;
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate: unknown }).toDate === "function"
  ) {
    return parseDate(value);
  }

  if (typeof value === "object" && value !== null) {
    const record = value as {
      seconds?: unknown;
      nanoseconds?: unknown;
      _seconds?: unknown;
      _nanoseconds?: unknown;
    };
    const hasTimestampFields =
      record.seconds != null ||
      record.nanoseconds != null ||
      record._seconds != null ||
      record._nanoseconds != null;

    if (hasTimestampFields) {
      return parseDate(value);
    }
  }

  return null;
}

export function serializeForClient<T>(value: T): T {
  const dateValue = toSerializableDate(value);
  if (dateValue) {
    return dateValue.toISOString() as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeForClient(item)) as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, serializeForClient(nested)]),
    ) as T;
  }

  return value;
}

function hasAttemptImage(value: unknown): boolean {
  if (!value || typeof value !== "object" || !("attempts" in value)) {
    return false;
  }

  const attempts = (value as { attempts?: unknown }).attempts;
  if (!Array.isArray(attempts)) {
    return false;
  }

  return attempts.some((attempt) => {
    if (!attempt || typeof attempt !== "object") {
      return false;
    }

    const imageUrl = (attempt as { imageUrl?: unknown }).imageUrl;
    return typeof imageUrl === "string" && imageUrl.trim().length > 0;
  });
}

export function shouldConcealRoundTarget(params: {
  gameMode: GameMode;
  roundStatus: RoundStatus | null | undefined;
  promptStartsAt: unknown;
  attemptData?: unknown;
}): boolean {
  if (params.gameMode !== "memory" || params.roundStatus !== "IN_ROUND") {
    return false;
  }

  if (
    isMemoryPreviewActive({
      gameMode: params.gameMode,
      promptStartsAt: params.promptStartsAt,
    })
  ) {
    return false;
  }

  return !hasAttemptImage(params.attemptData);
}

function getSortedPlayers(state: RoomState) {
  return Object.values(state.players).sort(
    (a, b) => (parseDate(a.joinedAt)?.getTime() ?? 0) - (parseDate(b.joinedAt)?.getTime() ?? 0),
  );
}

function getSortedScores(state: RoomState, roundId: string | null) {
  if (!roundId) return [];
  return Object.values(state.scores[roundId] ?? {}).sort((a, b) => b.bestScore - a.bestScore);
}

function getAttempts(state: RoomState, roundId: string | null, uid: string) {
  if (!roundId) return null;
  return state.attempts[roundId]?.[uid] ?? null;
}

export function buildRoomViewSnapshot(params: {
  state: RoomState;
  uid: string;
  view: RoomViewName;
}) {
  switch (params.view) {
    case "lobby":
      return buildLobbySnapshot(params.state, params.uid);
    case "round":
      return buildRoundSnapshot(params.state, params.uid);
    case "results":
      return buildResultsSnapshot(params.state, params.uid);
    case "transition":
      return buildTransitionSnapshot(params.state, params.uid);
    default:
      return null;
  }
}

function buildLobbySnapshot(state: RoomState, uid: string) {
  return {
    room: {
      roomId: state.room.roomId,
      code: state.room.code,
      status: state.room.status,
      currentRoundId: state.room.currentRoundId,
      settings: {
        gameMode: state.room.settings.gameMode,
        roundSeconds: state.room.settings.roundSeconds,
        maxAttempts: state.room.settings.maxAttempts,
        hintLimit: state.room.settings.hintLimit,
        totalRounds: state.room.settings.totalRounds,
      },
    },
    players: getSortedPlayers(state).map((player) => serializeForClient(player)),
    meUid: uid,
  };
}

function buildRoundSnapshot(state: RoomState, uid: string) {
  const currentRoundId = state.room.currentRoundId;
  const round = currentRoundId ? state.rounds[currentRoundId] ?? null : null;
  const attemptData = getAttempts(state, currentRoundId, uid);
  const shouldConcealTarget = round
    ? shouldConcealRoundTarget({
        gameMode: state.room.settings.gameMode,
        roundStatus: round.status,
        promptStartsAt: round.promptStartsAt,
        attemptData,
      })
    : false;

  return {
    room: {
      status: state.room.status,
      currentRoundId: state.room.currentRoundId,
      settings: {
        gameMode: state.room.settings.gameMode,
        roundSeconds: state.room.settings.roundSeconds,
        maxAttempts: state.room.settings.maxAttempts,
        hintLimit: state.room.settings.hintLimit,
      },
    },
    round: round
      ? serializeForClient({
          ...round,
          targetImageUrl: shouldConcealTarget ? "" : round.targetImageUrl,
          targetThumbUrl: shouldConcealTarget ? "" : round.targetThumbUrl,
        })
      : null,
    scores: getSortedScores(state, currentRoundId).map((entry) => serializeForClient(entry)),
    attempts: attemptData ? serializeForClient(attemptData) : null,
    playerCount: getSortedPlayers(state).length,
  };
}

function buildResultsSnapshot(state: RoomState, uid: string) {
  const currentRoundId = state.room.currentRoundId;
  const round = currentRoundId ? state.rounds[currentRoundId] ?? null : null;
  const me = state.players[uid] ?? null;

  return {
    room: {
      status: state.room.status,
      currentRoundId: state.room.currentRoundId,
      roundIndex: state.room.roundIndex,
      settings: {
        gameMode: state.room.settings.gameMode,
        totalRounds: state.room.settings.totalRounds,
      },
    },
    round: round ? serializeForClient(round) : null,
    scores: getSortedScores(state, currentRoundId).map((entry) => serializeForClient(entry)),
    players: me ? [serializeForClient(me)] : [],
    myAttempts: currentRoundId ? serializeForClient(state.attempts[currentRoundId]?.[uid] ?? null) : null,
  };
}

function buildTransitionSnapshot(state: RoomState, uid: string) {
  const me = state.players[uid] ?? null;

  return {
    room: {
      status: state.room.status,
    },
    players: me ? [serializeForClient(me)] : [],
  };
}
