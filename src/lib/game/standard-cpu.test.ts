import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createRoomState,
  loadRoomState,
  saveRoomState,
  __test__ as roomStateTest,
} from "@/lib/server/room-state";
import { dateAfterHours } from "@/lib/utils/time";

const mockGenerateGmPrompt = vi.fn();
const mockGenerateImage = vi.fn();
const mockCaptionFromImage = vi.fn();
const mockRewriteCpuPrompt = vi.fn();
const mockScoreImageSimilarity = vi.fn();

vi.mock("@/lib/gemini/client", () => ({
  generateGmPrompt: mockGenerateGmPrompt,
  captionFromImage: mockCaptionFromImage,
  rewriteCpuPrompt: mockRewriteCpuPrompt,
  scoreImageSimilarity: mockScoreImageSimilarity,
}));

vi.mock("@/lib/images", () => ({
  generateImage: mockGenerateImage,
  imageToBuffer: vi.fn(() => null),
  imageToPublicUrl: vi.fn(
    (image: { directUrl?: string }) => image.directUrl ?? null,
  ),
}));

function dataUrl(label: string) {
  return `data:image/png;base64,${Buffer.from(label).toString("base64")}`;
}

function createClassicLobbyState(cpuCount = 2) {
  const now = new Date("2026-04-07T10:00:00.000Z");
  const state = createRoomState({
    roomId: "ROOM1",
    code: "ROOM1",
    createdAt: now,
    expiresAt: dateAfterHours(24),
    createdByUid: "host",
    status: "LOBBY",
    currentRoundId: null,
    roundIndex: 0,
    settings: {
      maxPlayers: 8,
      roundSeconds: 60,
      maxAttempts: 1,
      aspectRatio: "1:1",
      imageModel: "gemini",
      promptModel: "flash",
      judgeModel: "flash",
      hintLimit: 0,
      totalRounds: 1,
      gameMode: "classic",
      cpuCount,
    },
    ui: {
      theme: "neo-brutal",
    },
  });

  state.players.host = {
    uid: "host",
    displayName: "Host",
    kind: "human",
    seatOrder: 0,
    isHost: true,
    joinedAt: now,
    expiresAt: dateAfterHours(24),
    lastSeenAt: now,
    ready: true,
    totalScore: 0,
  };

  return state;
}

describe("standard mode CPU attempts", () => {
  beforeEach(() => {
    roomStateTest.resetMemoryStore();
    mockGenerateGmPrompt.mockReset();
    mockGenerateImage.mockReset();
    mockCaptionFromImage.mockReset();
    mockRewriteCpuPrompt.mockReset();
    mockScoreImageSimilarity.mockReset();

    mockGenerateGmPrompt.mockResolvedValue({
      title: "Original",
      difficulty: 3,
      tags: ["tag-a"],
      prompt: "original target prompt with enough visual detail",
      negativePrompt: "",
      mustInclude: [],
      mustAvoid: [],
    });
    mockGenerateImage.mockImplementation(
      async ({ prompt }: { prompt: string }) => ({
        mimeType: "image/png",
        directUrl: dataUrl(prompt),
      }),
    );
    mockCaptionFromImage.mockResolvedValue({
      scene: "image scene",
      mainSubjects: ["subject"],
      keyObjects: ["object"],
      colors: ["red"],
      style: "stylized",
      composition: "balanced composition",
      textInImage: null,
    });
    mockRewriteCpuPrompt.mockResolvedValue(
      [
        "cpu reconstructed target prompt with exact red object",
        "blue window",
        "gold lantern",
        "tiled floor",
        "distant mountain",
        "tiny umbrella",
        "stone bridge",
        "misty sky",
      ].join(", "),
    );
    mockScoreImageSimilarity.mockResolvedValue({
      score: 37,
      matchedElements: ["subject"],
      missingElements: ["background"],
      note: "mock score",
    });
  });

  it("schedules classic CPUs and submits drifted prompts for each CPU player", async () => {
    await saveRoomState(createClassicLobbyState(2));
    const scheduled: Array<{ roomId: string; roundId: string }> = [];

    const { runClassicCpuAttempts, startRound } =
      await import("@/lib/game/round-service");
    const started = await startRound({
      roomId: "ROOM1",
      uid: "host",
      scheduleCpuAttempts: (params) => {
        scheduled.push(params);
      },
    });

    expect(started.roundId).toBe("round-1");
    expect(scheduled).toEqual([{ roomId: "ROOM1", roundId: "round-1" }]);

    await runClassicCpuAttempts(scheduled[0]!);

    const state = await loadRoomState("ROOM1");
    const cpuOneAttempt = state?.attempts["round-1"]?.["cpu-1"]?.attempts[0];
    const cpuTwoAttempt = state?.attempts["round-1"]?.["cpu-2"]?.attempts[0];

    expect(cpuOneAttempt).toMatchObject({
      status: "DONE",
      score: 37,
    });
    expect(cpuTwoAttempt).toMatchObject({
      status: "DONE",
      score: 37,
    });
    expect(cpuOneAttempt?.prompt).toContain("subject");
    expect(cpuTwoAttempt?.prompt).toContain("subject");
    expect(cpuOneAttempt?.prompt).toContain("color palette");
    expect(cpuTwoAttempt?.prompt).toContain("color palette");
    expect(cpuOneAttempt?.prompt).not.toBe(cpuTwoAttempt?.prompt);
    expect(cpuOneAttempt?.prompt).not.toContain("A simplified image of");
    expect(cpuOneAttempt?.prompt).not.toContain("CPU style");
    expect(cpuOneAttempt?.prompt).not.toContain("Create a weak");
    expect(cpuOneAttempt?.prompt).not.toContain("not an exact copy");
    expect(cpuOneAttempt?.prompt).not.toContain("Use ");
    expect(cpuOneAttempt?.prompt).not.toContain("Make ");
    expect(cpuOneAttempt?.prompt).not.toContain("Omit ");
    expect(cpuOneAttempt?.prompt).not.toContain("specific props, colors");
    expect(cpuOneAttempt?.prompt).not.toContain(
      "cpu reconstructed target prompt",
    );
    expect(cpuOneAttempt?.prompt).not.toContain("tiny umbrella");
    expect(cpuTwoAttempt?.prompt).not.toContain("tiny umbrella");
    expect(state?.scores["round-1"]?.["cpu-1"]?.bestScore).toBe(37);
    expect(state?.scores["round-1"]?.["cpu-2"]?.bestScore).toBe(37);
  });
});
