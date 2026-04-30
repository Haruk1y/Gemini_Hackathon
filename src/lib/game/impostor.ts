import type { CaptionSchema } from "@/lib/gemini/schemas";
import type { RoomState } from "@/lib/server/room-state";
import type {
  ImpostorRole,
  ImpostorTurnRecord,
  PlayerDoc,
  RoomSettings,
} from "@/lib/types/game";
import { dateAfterHours, parseDate } from "@/lib/utils/time";

export const IMPOSTOR_SIMILARITY_THRESHOLD = 70;
export const IMPOSTOR_TIMEOUT_PROMPT = "unclear dreamlike scene";
export const MAX_CPU_PLAYERS = 6;

const CPU_UID_PREFIX = "cpu-";
const TOKEN_STOPWORDS = new Set(["a", "an", "the"]);

function compactList(values: string[], limit: number) {
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function compactText(value: string, fallback: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export function reconstructPromptFromCaption(caption: CaptionSchema): string {
  const subjects = compactList(caption.mainSubjects, 3);
  const objects = compactList(caption.keyObjects, 5);
  const colors = compactList(caption.colors, 4);
  const scene = compactText(caption.scene, "illustrated scene");
  const style = compactText(caption.style, "stylized illustration");
  const composition = compactText(caption.composition, "balanced composition");

  return [
    scene,
    subjects.length > 0 ? `main subject: ${subjects.join(", ")}` : "",
    objects.length > 0 ? `key objects: ${objects.join(", ")}` : "",
    colors.length > 0 ? `color palette: ${colors.join(", ")}` : "",
    `style: ${style}`,
    `composition: ${composition}`,
    "no text",
    "no watermark",
  ]
    .filter(Boolean)
    .join(", ");
}

export function buildTelephonePrompt(params: {
  role: ImpostorRole;
  reconstructedPrompt: string;
  playerPrompt?: string;
}): string {
  const playerPrompt = params.playerPrompt?.trim() ?? "";

  if (params.role === "impostor") {
    return [
      params.reconstructedPrompt,
      playerPrompt ? `player interpretation hint: ${playerPrompt}` : "",
      "rebuild this for the next turn of an image telephone chain",
      "keep the result believable but introduce subtle drift",
      "quietly alter some subject details, secondary objects, color emphasis, and composition balance",
      "do not make the sabotage obvious",
      "preserve overall plausibility",
      "no text",
      "no watermark",
    ]
      .filter(Boolean)
      .join(", ");
  }

  return playerPrompt || params.reconstructedPrompt;
}

export function chooseImpostorAssignments(players: PlayerDoc[]): {
  turnOrder: string[];
  rolesByUid: Record<string, ImpostorRole>;
} {
  const turnOrder = players.map((player) => player.uid);
  const impostorUid = turnOrder[Math.floor(Math.random() * turnOrder.length)] ?? turnOrder[0];

  return {
    turnOrder,
    rolesByUid: Object.fromEntries(
      turnOrder.map((uid) => [uid, uid === impostorUid ? "impostor" : "agent"]),
    ) as Record<string, ImpostorRole>,
  };
}

function desiredCpuCount(settings: RoomSettings, players: Record<string, PlayerDoc>) {
  if (settings.gameMode !== "impostor") {
    return 0;
  }

  const humanCount = Object.values(players).filter((player) => player.kind === "human").length;
  const availableSlots = Math.max(0, settings.maxPlayers - humanCount);
  return Math.max(0, Math.min(settings.cpuCount, availableSlots, MAX_CPU_PLAYERS));
}

function buildCpuPlayer(index: number): PlayerDoc {
  const now = new Date();
  return {
    uid: `${CPU_UID_PREFIX}${index}`,
    displayName: `CPU ${index}`,
    kind: "cpu",
    seatOrder: index,
    isHost: false,
    joinedAt: now,
    expiresAt: dateAfterHours(24),
    lastSeenAt: now,
    ready: true,
    totalScore: 0,
  };
}

export function sortPlayersBySeatOrder(players: PlayerDoc[]): PlayerDoc[] {
  return [...players].sort((a, b) => {
    const orderA = a.seatOrder ?? Number.MAX_SAFE_INTEGER;
    const orderB = b.seatOrder ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) {
      return orderA - orderB;
    }

    const joinedA = parseDate(a.joinedAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const joinedB = parseDate(b.joinedAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (joinedA !== joinedB) {
      return joinedA - joinedB;
    }

    return a.uid.localeCompare(b.uid);
  });
}

export function nextSeatOrder(players: Record<string, PlayerDoc>): number {
  return Object.values(players).reduce((max, player) => {
    if (typeof player.seatOrder !== "number" || !Number.isFinite(player.seatOrder)) {
      return max;
    }
    return Math.max(max, player.seatOrder);
  }, -1) + 1;
}

export function syncCpuPlayers(state: RoomState): number {
  const nextCpuCount = desiredCpuCount(state.room.settings, state.players);
  const desiredCpuUids = new Set(
    Array.from({ length: nextCpuCount }, (_, index) => `${CPU_UID_PREFIX}${index + 1}`),
  );

  for (const player of Object.values(state.players)) {
    if (player.kind === "cpu" && !desiredCpuUids.has(player.uid)) {
      delete state.players[player.uid];
    }
  }

  for (let index = 1; index <= nextCpuCount; index += 1) {
    const uid = `${CPU_UID_PREFIX}${index}`;
    const existing = state.players[uid];
    if (existing) {
      existing.kind = "cpu";
      existing.displayName = `CPU ${index}`;
      existing.isHost = false;
      existing.ready = true;
      existing.lastSeenAt = new Date();
      existing.expiresAt = dateAfterHours(24);
      continue;
    }

    const cpuPlayer = buildCpuPlayer(index);
    cpuPlayer.seatOrder = nextSeatOrder(state.players);
    state.players[uid] = cpuPlayer;
  }

  state.room.settings.cpuCount = nextCpuCount;
  return nextCpuCount;
}

export function resetPlayerReadinessForLobby(players: Record<string, PlayerDoc>) {
  for (const player of Object.values(players)) {
    player.ready = true;
    player.totalScore = 0;
    player.lastSeenAt = new Date();
  }
}

export function resolveVoteTarget(votesByUid: Record<string, string>): {
  targetUid: string | null;
  voteCount: number;
} {
  const tally = new Map<string, number>();

  for (const targetUid of Object.values(votesByUid)) {
    tally.set(targetUid, (tally.get(targetUid) ?? 0) + 1);
  }

  let topCount = 0;
  let topUid: string | null = null;
  let tied = false;

  for (const [targetUid, count] of tally.entries()) {
    if (count > topCount) {
      topCount = count;
      topUid = targetUid;
      tied = false;
    } else if (count === topCount) {
      tied = true;
    }
  }

  return {
    targetUid: tied ? null : topUid,
    voteCount: topCount,
  };
}

export function chooseCpuVote(params: {
  uid: string;
  role: ImpostorRole;
  turnOrder: string[];
  turnRecords: ImpostorTurnRecord[];
  rolesByUid: Record<string, ImpostorRole>;
}): { targetUid: string | null; reason: string } {
  const candidates = params.turnOrder.filter((candidateUid) => candidateUid !== params.uid);
  if (candidates.length === 0) {
    return {
      targetUid: null,
      reason: "no-candidates",
    };
  }

  if (params.role === "agent") {
    const records = params.turnRecords.filter((record) => record.uid !== params.uid);
    const mostSuspicious =
      [...records].sort((a, b) => a.similarityScore - b.similarityScore)[0]?.uid ?? candidates[0];

    return {
      targetUid: mostSuspicious,
      reason: "lowest-step-similarity",
    };
  }

  const safeTarget =
    candidates.find((candidateUid) => params.rolesByUid[candidateUid] !== "impostor") ??
    candidates[0];

  return {
    targetUid: safeTarget,
    reason: "protect-impostor",
  };
}

export function isCpuUid(uid: string) {
  return uid.startsWith(CPU_UID_PREFIX);
}

export function deriveImpostorTitle(prompt: string) {
  const tokens = prompt
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .filter((token) => !TOKEN_STOPWORDS.has(token))
    .slice(0, 4);

  return tokens.length > 0 ? tokens.join(" ") : "Art Impostor";
}
