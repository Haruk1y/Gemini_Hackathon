import {
  attemptPrivateRef,
  playerRef,
  playersRef,
  roundRef,
  roomRef,
  scoresRef,
} from "@/lib/api/paths";
import { requireRoom } from "@/lib/game/guards";
import { parseDate } from "@/lib/utils/time";

export type RoomViewName = "lobby" | "round" | "results" | "transition";

export async function buildRoomViewSnapshot(params: {
  roomId: string;
  uid: string;
  view: RoomViewName;
}) {
  switch (params.view) {
    case "lobby":
      return buildLobbySnapshot(params.roomId, params.uid);
    case "round":
      return buildRoundSnapshot(params.roomId, params.uid);
    case "results":
      return buildResultsSnapshot(params.roomId, params.uid);
    case "transition":
      return buildTransitionSnapshot(params.roomId, params.uid);
    default:
      return null;
  }
}

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

async function buildLobbySnapshot(roomId: string, uid: string) {
  const [roomSnapshot, playersSnapshot] = await Promise.all([
    roomRef(roomId).get(),
    playersRef(roomId).orderBy("joinedAt", "asc").get(),
  ]);

  const room = requireRoom(roomSnapshot);
  return {
    room: {
      roomId: room.roomId,
      code: room.code,
      status: room.status,
      currentRoundId: room.currentRoundId,
      settings: {
        roundSeconds: room.settings.roundSeconds,
        maxAttempts: room.settings.maxAttempts,
        totalRounds: room.settings.totalRounds,
      },
    },
    players: playersSnapshot.docs.map((item) => serializeForClient(item.data())),
    meUid: uid,
  };
}

async function buildRoundSnapshot(roomId: string, uid: string) {
  const roomSnapshot = await roomRef(roomId).get();
  const room = requireRoom(roomSnapshot);

  const currentRoundId = room.currentRoundId;
  const [playersSnapshot, roundSnapshot, scoresSnapshot, attemptSnapshot] = await Promise.all([
    playersRef(roomId).get(),
    currentRoundId ? roundRef(roomId, currentRoundId).get() : Promise.resolve(null),
    currentRoundId
      ? scoresRef(roomId, currentRoundId).orderBy("bestScore", "desc").get()
      : Promise.resolve(null),
    currentRoundId ? attemptPrivateRef(roomId, currentRoundId, uid).get() : Promise.resolve(null),
  ]);

  return {
    room: {
      status: room.status,
      currentRoundId: room.currentRoundId,
      settings: {
        roundSeconds: room.settings.roundSeconds,
        maxAttempts: room.settings.maxAttempts,
        hintLimit: room.settings.hintLimit,
      },
    },
    round: roundSnapshot?.exists ? serializeForClient(roundSnapshot.data()) : null,
    scores: scoresSnapshot?.docs.map((entry) => serializeForClient(entry.data())) ?? [],
    attempts: attemptSnapshot?.exists ? serializeForClient(attemptSnapshot.data()) : null,
    playerCount: playersSnapshot.size,
  };
}

async function buildResultsSnapshot(roomId: string, uid: string) {
  const roomSnapshot = await roomRef(roomId).get();
  const room = requireRoom(roomSnapshot);

  const currentRoundId = room.currentRoundId;
  const [roundSnapshot, scoresSnapshot, playerSnapshot, attemptSnapshot] = await Promise.all([
    currentRoundId ? roundRef(roomId, currentRoundId).get() : Promise.resolve(null),
    currentRoundId
      ? scoresRef(roomId, currentRoundId).orderBy("bestScore", "desc").get()
      : Promise.resolve(null),
    playerRef(roomId, uid).get(),
    currentRoundId ? attemptPrivateRef(roomId, currentRoundId, uid).get() : Promise.resolve(null),
  ]);

  return {
    room: {
      status: room.status,
      currentRoundId: room.currentRoundId,
      roundIndex: room.roundIndex,
      settings: {
        totalRounds: room.settings.totalRounds,
      },
    },
    round: roundSnapshot?.exists ? serializeForClient(roundSnapshot.data()) : null,
    scores: scoresSnapshot?.docs.map((item) => serializeForClient(item.data())) ?? [],
    players: playerSnapshot.exists ? [serializeForClient(playerSnapshot.data())] : [],
    myAttempts: attemptSnapshot?.exists ? serializeForClient(attemptSnapshot.data()) : null,
  };
}

async function buildTransitionSnapshot(roomId: string, uid: string) {
  const [roomSnapshot, playerSnapshot] = await Promise.all([
    roomRef(roomId).get(),
    playerRef(roomId, uid).get(),
  ]);

  const room = requireRoom(roomSnapshot);
  const player = playerSnapshot.exists ? playerSnapshot.data() : null;

  return {
    room: {
      status: room.status,
    },
    players: player ? [serializeForClient(player)] : [],
  };
}
