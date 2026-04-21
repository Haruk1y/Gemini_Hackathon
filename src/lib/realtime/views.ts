import { isMemoryPreviewActive } from "@/lib/game/modes";
import type { RoomState } from "@/lib/server/room-state";
import type {
  GameMode,
  ImpostorRoundModeState,
  ImpostorTurnRecord,
  RoundStatus,
} from "@/lib/types/game";
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
    (a, b) => {
      const seatA = typeof a.seatOrder === "number" ? a.seatOrder : Number.MAX_SAFE_INTEGER;
      const seatB = typeof b.seatOrder === "number" ? b.seatOrder : Number.MAX_SAFE_INTEGER;
      if (seatA !== seatB) {
        return seatA - seatB;
      }

      const joinedA = parseDate(a.joinedAt)?.getTime() ?? 0;
      const joinedB = parseDate(b.joinedAt)?.getTime() ?? 0;
      return joinedA - joinedB;
    },
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

function getImpostorModeState(state: RoomState, roundId: string | null) {
  if (!roundId) return null;
  const round = state.rounds[roundId];
  const roundPrivate = state.roundPrivates[roundId];

  if (round?.modeState?.kind !== "impostor" || !roundPrivate?.modeState) {
    return null;
  }

  return {
    round: round as typeof round & { modeState: ImpostorRoundModeState },
    roundPrivate: roundPrivate as typeof roundPrivate & {
      modeState: NonNullable<typeof roundPrivate.modeState>;
    },
  };
}

function getOrderedImpostorTurnRecords(params: {
  turnOrder: string[];
  turnRecords: ImpostorTurnRecord[];
}) {
  const recordsByUid = new Map<string, ImpostorTurnRecord>();

  for (const record of params.turnRecords) {
    recordsByUid.set(record.uid, record);
  }

  const orderedRecords = params.turnOrder.flatMap((uid) => {
    const record = recordsByUid.get(uid);
    return record ? [record] : [];
  });

  const orderedUidSet = new Set(params.turnOrder);
  const extraRecords = params.turnRecords.filter((record) => !orderedUidSet.has(record.uid));

  return [...orderedRecords, ...extraRecords];
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
      nextRoundPreparation: state.preparedRound
        ? {
            index: state.preparedRound.index,
            status: state.preparedRound.status,
          }
        : null,
      settings: {
        gameMode: state.room.settings.gameMode,
        maxPlayers: state.room.settings.maxPlayers,
        roundSeconds: state.room.settings.roundSeconds,
        maxAttempts: state.room.settings.maxAttempts,
        hintLimit: state.room.settings.hintLimit,
        imageModel: state.room.settings.imageModel,
        promptModel: state.room.settings.promptModel,
        judgeModel: state.room.settings.judgeModel,
        totalRounds: state.room.settings.totalRounds,
        cpuCount: state.room.settings.cpuCount,
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
  const impostor = getImpostorModeState(state, currentRoundId);

  let roundData = round;
  let myRole: string | null = null;
  let isMyTurn = false;
  let currentTurnUid: string | null = null;

  if (impostor) {
    currentTurnUid = impostor.round.modeState.currentTurnUid;
    isMyTurn =
      impostor.round.modeState.phase === "CHAIN" && impostor.round.modeState.currentTurnUid === uid;
    myRole = impostor.roundPrivate.modeState.rolesByUid[uid] ?? null;

    if (!isMyTurn && impostor.round.modeState.phase === "CHAIN") {
      roundData = {
        ...impostor.round,
        targetImageUrl: "",
        targetThumbUrl: "",
        modeState: {
          ...impostor.round.modeState,
          chainImageUrl: "",
        },
      };
    }
  }

  const shouldConcealTarget = roundData
    ? shouldConcealRoundTarget({
        gameMode: state.room.settings.gameMode,
        roundStatus: roundData.status,
        promptStartsAt: roundData.promptStartsAt,
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
        imageModel: state.room.settings.imageModel,
        promptModel: state.room.settings.promptModel,
        judgeModel: state.room.settings.judgeModel,
        cpuCount: state.room.settings.cpuCount,
      },
    },
    round: roundData
      ? serializeForClient({
          ...roundData,
          targetImageUrl: shouldConcealTarget ? "" : roundData.targetImageUrl,
          targetThumbUrl: shouldConcealTarget ? "" : roundData.targetThumbUrl,
        })
      : null,
    scores: getSortedScores(state, currentRoundId).map((entry) => serializeForClient(entry)),
    attempts: attemptData ? serializeForClient(attemptData) : null,
    players: getSortedPlayers(state).map((player) => serializeForClient(player)),
    playerCount: getSortedPlayers(state).length,
    myRole,
    isMyTurn,
    currentTurnUid,
    turnTimeline: impostor && impostor.round.modeState.phase !== "CHAIN"
      ? serializeForClient(
          getOrderedImpostorTurnRecords({
            turnOrder: impostor.round.modeState.turnOrder,
            turnRecords: impostor.roundPrivate.modeState.turnRecords,
          }).map((record) => ({
            uid: record.uid,
            displayName: record.displayName,
            kind: record.kind,
            imageUrl: record.imageUrl,
            similarityScore: record.similarityScore,
            matchedElements: record.matchedElements,
            missingElements: record.missingElements,
            judgeNote: record.judgeNote,
            timedOut: record.timedOut ?? false,
          })),
        )
      : [],
  };
}

function buildResultsSnapshot(state: RoomState, uid: string) {
  const currentRoundId = state.room.currentRoundId;
  const round = currentRoundId ? state.rounds[currentRoundId] ?? null : null;
  const attempts = currentRoundId ? state.attempts[currentRoundId]?.[uid] ?? null : null;
  const impostor = getImpostorModeState(state, currentRoundId);
  const revealLocked = impostor ? impostor.round.modeState.phase !== "REVEAL" : false;
  const votesByUid = impostor?.roundPrivate.modeState.votesByUid ?? {};

  return {
    room: {
      status: state.room.status,
      currentRoundId: state.room.currentRoundId,
      roundIndex: state.room.roundIndex,
      settings: {
        gameMode: state.room.settings.gameMode,
        imageModel: state.room.settings.imageModel,
        promptModel: state.room.settings.promptModel,
        judgeModel: state.room.settings.judgeModel,
        totalRounds: state.room.settings.totalRounds,
        cpuCount: state.room.settings.cpuCount,
      },
    },
    round: round ? serializeForClient(round) : null,
    scores: getSortedScores(state, currentRoundId).map((entry) => serializeForClient(entry)),
    players: getSortedPlayers(state).map((player) => serializeForClient(player)),
    myAttempts: attempts ? serializeForClient(attempts) : null,
    myRole: impostor?.roundPrivate.modeState.rolesByUid[uid] ?? null,
    voteProgress: impostor
      ? {
          submitted: Object.keys(votesByUid).length,
          total: Object.keys(state.players).length,
          meTargetUid: votesByUid[uid] ?? null,
        }
      : null,
    finalSimilarityScore:
      impostor?.roundPrivate.modeState.finalJudge?.score ?? impostor?.round.modeState.finalSimilarityScore ?? null,
    turnTimeline: impostor
      ? serializeForClient(
          getOrderedImpostorTurnRecords({
            turnOrder: impostor.round.modeState.turnOrder,
            turnRecords: impostor.roundPrivate.modeState.turnRecords,
          }).map((record) => ({
            uid: record.uid,
            displayName: record.displayName,
            kind: record.kind,
            imageUrl: record.imageUrl,
            similarityScore: record.similarityScore,
            matchedElements: record.matchedElements,
            missingElements: record.missingElements,
            judgeNote: record.judgeNote,
            prompt: revealLocked ? undefined : record.prompt,
            role: revealLocked ? undefined : record.role,
            timedOut: record.timedOut ?? false,
            votedForUid: revealLocked ? undefined : votesByUid[record.uid] ?? null,
          })),
        )
      : [],
    revealLocked,
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
