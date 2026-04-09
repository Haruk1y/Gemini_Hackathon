import { describe, expect, it } from "vitest";

import { chooseCpuVote, resolveVoteTarget } from "@/lib/game/impostor";

describe("resolveVoteTarget", () => {
  it("returns the unique highest-voted target", () => {
    expect(
      resolveVoteTarget({
        a: "guest",
        b: "guest",
        c: "host",
      }),
    ).toEqual({
      targetUid: "guest",
      voteCount: 2,
    });
  });

  it("returns null when the highest vote is tied", () => {
    expect(
      resolveVoteTarget({
        a: "guest",
        b: "host",
      }),
    ).toEqual({
      targetUid: null,
      voteCount: 1,
    });
  });
});

describe("chooseCpuVote", () => {
  it("makes agent cpu suspect the lowest-similarity turn", () => {
    const result = chooseCpuVote({
      uid: "cpu-1",
      role: "agent",
      turnOrder: ["cpu-1", "host", "guest"],
      turnRecords: [
        {
          uid: "host",
          displayName: "Host",
          kind: "human",
          role: "agent",
          prompt: "host prompt",
          imageUrl: "https://example.com/host.png",
          referenceImageUrl: "https://example.com/original.png",
          similarityScore: 82,
          matchedElements: [],
          missingElements: [],
          judgeNote: "",
          createdAt: new Date(),
        },
        {
          uid: "guest",
          displayName: "Guest",
          kind: "human",
          role: "impostor",
          prompt: "guest prompt",
          imageUrl: "https://example.com/guest.png",
          referenceImageUrl: "https://example.com/host.png",
          similarityScore: 41,
          matchedElements: [],
          missingElements: [],
          judgeNote: "",
          createdAt: new Date(),
        },
      ],
      rolesByUid: {
        "cpu-1": "agent",
        host: "agent",
        guest: "impostor",
      },
    });

    expect(result.targetUid).toBe("guest");
  });
});
