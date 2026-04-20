import { Redis } from "@upstash/redis";
import { nanoid } from "nanoid";

import type {
  AttemptsPrivateDoc,
  PlayerDoc,
  PreparedRoundDoc,
  RoundPrivateDoc,
  RoundPublicDoc,
  RoomDoc,
  ScoreDoc,
} from "@/lib/types/game";
import { AppError } from "@/lib/utils/errors";
import { parseDate } from "@/lib/utils/time";

const ROOM_STATE_TTL_SECONDS = 24 * 60 * 60;
const ROOM_EXPIRING_KEY = "rooms:expiring";
const LOCK_RETRY_MS = 80;
const DEFAULT_LOCK_TTL_MS = 8_000;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

type RoomStateBackend = "redis" | "memory";
type RedisEnvSource = "UPSTASH_REDIS_REST_*" | "UPSTASH_KV_REST_API_*" | null;

export interface RoomState {
  room: RoomDoc;
  players: Record<string, PlayerDoc>;
  rounds: Record<string, RoundPublicDoc>;
  roundPrivates: Record<string, RoundPrivateDoc>;
  attempts: Record<string, Record<string, AttemptsPrivateDoc>>;
  scores: Record<string, Record<string, ScoreDoc>>;
  preparedRound: PreparedRoundDoc | null;
  roundSequence: number;
  version: number;
}

interface MemoryValue {
  value: unknown;
  expiresAt: number;
}

const memoryKv = new Map<string, MemoryValue>();
const memorySorted = new Map<string, Map<string, number>>();
const memoryLocks = new Map<string, MemoryValue>();

function stateKey(roomId: string) {
  return `room:${roomId}:state`;
}

function lockKey(roomId: string) {
  return `lock:room:${roomId}`;
}

function submitLockKey(roomId: string, roundId: string, uid: string) {
  return `lock:submit:${roomId}:${roundId}:${uid}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getExpiryMs(state: RoomState): number {
  return parseDate(state.room.expiresAt)?.getTime() ?? Date.now() + ROOM_STATE_TTL_SECONDS * 1000;
}

function serializeState(state: RoomState): string {
  return JSON.stringify(state);
}

function reviveDate(value: unknown): unknown {
  if (typeof value === "string" && ISO_DATE_PATTERN.test(value)) {
    return new Date(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => reviveDate(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, reviveDate(nested)]),
    );
  }

  return value;
}

function deserializeState(raw: unknown): RoomState {
  if (typeof raw === "string") {
    return reviveDate(JSON.parse(raw)) as RoomState;
  }

  return reviveDate(raw) as RoomState;
}

function pruneMemoryEntries() {
  const now = Date.now();

  for (const [key, entry] of memoryKv.entries()) {
    if (entry.expiresAt <= now) {
      memoryKv.delete(key);
    }
  }

  for (const [key, entry] of memoryLocks.entries()) {
    if (entry.expiresAt <= now) {
      memoryLocks.delete(key);
    }
  }

  const expiringRooms = memorySorted.get(ROOM_EXPIRING_KEY);
  if (expiringRooms) {
    for (const [member, score] of expiringRooms.entries()) {
      if (score <= now) {
        expiringRooms.delete(member);
      }
    }
  }
}

let redisClient: Redis | null | undefined;

function resolveRedisConfig(env: NodeJS.ProcessEnv = process.env) {
  const restUrl = env.UPSTASH_REDIS_REST_URL?.trim();
  const restToken = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (restUrl && restToken) {
    return {
      url: restUrl,
      token: restToken,
      envSource: "UPSTASH_REDIS_REST_*" as const,
    };
  }

  const kvUrl = env.UPSTASH_KV_REST_API_URL?.trim();
  const kvToken = env.UPSTASH_KV_REST_API_TOKEN?.trim();
  if (kvUrl && kvToken) {
    return {
      url: kvUrl,
      token: kvToken,
      envSource: "UPSTASH_KV_REST_API_*" as const,
    };
  }

  return null;
}

function resolveRoomStateBackend(env: NodeJS.ProcessEnv = process.env): {
  kind: RoomStateBackend;
  envSource: RedisEnvSource;
} {
  const config = resolveRedisConfig(env);
  if (config) {
    return {
      kind: "redis",
      envSource: config.envSource,
    };
  }

  if (env.NODE_ENV === "production") {
    throw new AppError(
      "INTERNAL_ERROR",
      "Redis storage is not configured in production.",
      false,
      500,
    );
  }

  return {
    kind: "memory",
    envSource: null,
  };
}

function getRedisClient(): Redis | null {
  if (redisClient !== undefined) {
    return redisClient;
  }

  const backend = resolveRoomStateBackend();
  if (backend.kind === "memory") {
    redisClient = null;
    return redisClient;
  }

  const config = resolveRedisConfig();
  redisClient = config ? new Redis({ url: config.url, token: config.token }) : null;
  return redisClient;
}

export function getRoomStateBackendInfo() {
  const backend = resolveRoomStateBackend();
  getRedisClient();
  return backend;
}

async function getValue(key: string): Promise<unknown | null> {
  const redis = getRedisClient();
  if (redis) {
    return (await redis.get(key)) ?? null;
  }

  pruneMemoryEntries();
  return memoryKv.get(key)?.value ?? null;
}

async function setValue(key: string, value: string, expiresAtMs: number): Promise<void> {
  const redis = getRedisClient();
  const ttlSeconds = Math.max(60, Math.ceil((expiresAtMs - Date.now()) / 1000));

  if (redis) {
    await redis.set(key, value, { ex: ttlSeconds });
    return;
  }

  memoryKv.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

async function deleteValue(key: string): Promise<void> {
  const redis = getRedisClient();
  if (redis) {
    await redis.del(key);
    return;
  }

  memoryKv.delete(key);
}

async function addExpiringRoom(roomId: string, expiresAtMs: number): Promise<void> {
  const redis = getRedisClient();
  if (redis) {
    await redis.zadd(ROOM_EXPIRING_KEY, { score: expiresAtMs, member: roomId });
    return;
  }

  const current = memorySorted.get(ROOM_EXPIRING_KEY) ?? new Map<string, number>();
  current.set(roomId, expiresAtMs);
  memorySorted.set(ROOM_EXPIRING_KEY, current);
}

async function removeExpiringRoom(roomId: string): Promise<void> {
  const redis = getRedisClient();
  if (redis) {
    await redis.zrem(ROOM_EXPIRING_KEY, roomId);
    return;
  }

  memorySorted.get(ROOM_EXPIRING_KEY)?.delete(roomId);
}

export async function listExpiredRoomIds(limit: number, now = new Date()): Promise<string[]> {
  const redis = getRedisClient();
  if (redis) {
    return await redis.zrange<string[]>(
      ROOM_EXPIRING_KEY,
      "-inf",
      now.getTime(),
      { byScore: true, offset: 0, count: limit },
    );
  }

  pruneMemoryEntries();
  const expiringRooms = memorySorted.get(ROOM_EXPIRING_KEY);
  if (!expiringRooms) return [];

  return [...expiringRooms.entries()]
    .filter(([, score]) => score <= now.getTime())
    .sort((a, b) => a[1] - b[1])
    .slice(0, limit)
    .map(([roomId]) => roomId);
}

async function acquireLock(key: string, ttlMs: number): Promise<string> {
  const token = nanoid(18);
  const redis = getRedisClient();

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (redis) {
      const result = await redis.set(key, token, { nx: true, px: ttlMs });
      if (result === "OK") {
        return token;
      }
    } else {
      pruneMemoryEntries();
      const existing = memoryLocks.get(key);
      if (!existing || existing.expiresAt <= Date.now()) {
        memoryLocks.set(key, { value: token, expiresAt: Date.now() + ttlMs });
        return token;
      }
    }

    await sleep(LOCK_RETRY_MS);
  }

  throw new AppError("RATE_LIMIT", "処理が混み合っています。少し待ってから再試行してください。", true, 429);
}

async function releaseLock(key: string, token: string): Promise<void> {
  const redis = getRedisClient();
  if (redis) {
    await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0",
      [key],
      [token],
    );
    return;
  }

  const existing = memoryLocks.get(key);
  if (existing?.value === token) {
    memoryLocks.delete(key);
  }
}

async function withLock<T>(key: string, fn: () => Promise<T>, ttlMs = DEFAULT_LOCK_TTL_MS): Promise<T> {
  const token = await acquireLock(key, ttlMs);
  try {
    return await fn();
  } finally {
    await releaseLock(key, token);
  }
}

export async function withRoomLock<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
  return withLock(lockKey(roomId), fn);
}

export async function withSubmitLock<T>(
  roomId: string,
  roundId: string,
  uid: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withLock(submitLockKey(roomId, roundId, uid), fn);
}

export function createRoomState(room: RoomDoc): RoomState {
  return {
    room,
    players: {},
    rounds: {},
    roundPrivates: {},
    attempts: {},
    scores: {},
    preparedRound: null,
    roundSequence: 0,
    version: 1,
  };
}

export async function roomStateExists(roomId: string): Promise<boolean> {
  return Boolean(await getValue(stateKey(roomId)));
}

export async function loadRoomState(roomId: string): Promise<RoomState | null> {
  const raw = await getValue(stateKey(roomId));
  if (!raw) return null;
  return deserializeState(raw);
}

export async function saveRoomState(state: RoomState): Promise<void> {
  const expiresAtMs = getExpiryMs(state);
  await setValue(stateKey(state.room.roomId), serializeState(state), expiresAtMs);
  await addExpiringRoom(state.room.roomId, expiresAtMs);
}

export async function deleteRoomState(roomId: string): Promise<void> {
  await deleteValue(stateKey(roomId));
  await removeExpiringRoom(roomId);
}

export function bumpRoomVersion(state: RoomState): RoomState {
  state.version += 1;
  return state;
}

export const __test__ = {
  resetMemoryStore() {
    memoryKv.clear();
    memorySorted.clear();
    memoryLocks.clear();
    redisClient = null;
  },
  deserializeState,
  resolveRedisConfig,
  resolveRoomStateBackend,
};
