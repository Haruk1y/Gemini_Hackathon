import { describe, expect, it } from "vitest";

import { DEFAULT_ROOM_SETTINGS } from "@/lib/game/defaults";
import { __test__, createRoomState } from "@/lib/server/room-state";

describe("room-state deserializeState", () => {
  it("accepts a JSON string payload", () => {
    const state = createRoomState({
      roomId: "ROOM01",
      code: "ROOM01",
      createdAt: new Date("2026-04-07T06:00:00.000Z"),
      expiresAt: new Date("2026-04-08T06:00:00.000Z"),
      createdByUid: "anon_1",
      status: "LOBBY",
      currentRoundId: null,
      roundIndex: 0,
      settings: {
        ...DEFAULT_ROOM_SETTINGS,
        gameMode: "classic",
      },
      ui: {
        theme: "neo-brutal",
      },
    });

    const revived = __test__.deserializeState(JSON.stringify(state));

    expect(revived.room.roomId).toBe("ROOM01");
    expect(revived.room.createdAt).toBeInstanceOf(Date);
    expect(revived.room.expiresAt).toBeInstanceOf(Date);
  });

  it("accepts an already-parsed object payload", () => {
    const state = createRoomState({
      roomId: "ROOM02",
      code: "ROOM02",
      createdAt: new Date("2026-04-07T06:00:00.000Z"),
      expiresAt: new Date("2026-04-08T06:00:00.000Z"),
      createdByUid: "anon_2",
      status: "LOBBY",
      currentRoundId: null,
      roundIndex: 0,
      settings: {
        ...DEFAULT_ROOM_SETTINGS,
        roundSeconds: 45,
        totalRounds: 2,
        gameMode: "memory",
      },
      ui: {
        theme: "neo-brutal",
      },
    });

    const revived = __test__.deserializeState(JSON.parse(JSON.stringify(state)));

    expect(revived.room.roomId).toBe("ROOM02");
    expect(revived.room.createdAt).toBeInstanceOf(Date);
    expect(revived.room.expiresAt).toBeInstanceOf(Date);
  });
});

describe("room-state backend resolution", () => {
  it("prefers UPSTASH_REDIS_REST_* when present", () => {
    const config = __test__.resolveRedisConfig({
      NODE_ENV: "test",
      UPSTASH_REDIS_REST_URL: "https://redis.example.com",
      UPSTASH_REDIS_REST_TOKEN: "rest-token",
      UPSTASH_KV_REST_API_URL: "https://kv.example.com",
      UPSTASH_KV_REST_API_TOKEN: "kv-token",
    });

    expect(config).toEqual({
      url: "https://redis.example.com",
      token: "rest-token",
      envSource: "UPSTASH_REDIS_REST_*",
    });
  });

  it("falls back to UPSTASH_KV_REST_API_* when redis env names are absent", () => {
    const config = __test__.resolveRedisConfig({
      NODE_ENV: "test",
      UPSTASH_KV_REST_API_URL: "https://kv.example.com",
      UPSTASH_KV_REST_API_TOKEN: "kv-token",
    });

    expect(config).toEqual({
      url: "https://kv.example.com",
      token: "kv-token",
      envSource: "UPSTASH_KV_REST_API_*",
    });
  });

  it("rejects memory fallback in production", () => {
    expect(() =>
      __test__.resolveRoomStateBackend({
        NODE_ENV: "production",
      }),
    ).toThrow("Redis storage is not configured in production.");
  });
});
