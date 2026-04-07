import { describe, expect, it } from "vitest";

import { serializeForClient, shouldConcealRoundTarget } from "@/lib/realtime/views";

describe("serializeForClient", () => {
  it("keeps plain strings unchanged", () => {
    expect(serializeForClient("2001")).toBe("2001");
    expect(serializeForClient("2001-01-01T00:00:00.000Z")).toBe("2001-01-01T00:00:00.000Z");
  });

  it("serializes nested date values without rewriting display names", () => {
    const serialized = serializeForClient({
      displayName: "2001",
      totalScore: 1,
      joinedAt: new Date("2026-04-03T02:30:00.000Z"),
      nested: {
        roundIndex: 2,
        lastSeenAt: {
          seconds: "1775183400",
          nanoseconds: "500000000",
        },
      },
    });

    expect(serialized).toEqual({
      displayName: "2001",
      totalScore: 1,
      joinedAt: "2026-04-03T02:30:00.000Z",
      nested: {
        roundIndex: 2,
        lastSeenAt: "2026-04-03T02:30:00.500Z",
      },
    });
  });
});

describe("shouldConcealRoundTarget", () => {
  it("conceals the memory target after preview when the player has no generated image yet", () => {
    expect(
      shouldConcealRoundTarget({
        gameMode: "memory",
        roundStatus: "IN_ROUND",
        promptStartsAt: new Date(Date.now() - 1_000),
      }),
    ).toBe(true);
  });

  it("reveals the memory target once the player has a generated image", () => {
    expect(
      shouldConcealRoundTarget({
        gameMode: "memory",
        roundStatus: "IN_ROUND",
        promptStartsAt: new Date(Date.now() - 1_000),
        attemptData: {
          attempts: [{ imageUrl: "https://example.com/attempt.png" }],
        },
      }),
    ).toBe(false);
  });
});
