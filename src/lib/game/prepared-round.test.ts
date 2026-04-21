import { beforeEach, describe, expect, it, vi } from "vitest";

import { dateAfterHours } from "@/lib/utils/time";

const mockGenerateGmPrompt = vi.fn();
const mockGenerateImage = vi.fn();

vi.mock("@/lib/gemini/client", () => ({
  captionFromImage: vi.fn(),
  generateGmPrompt: mockGenerateGmPrompt,
  rewriteCpuPrompt: vi.fn(),
  scoreImageSimilarity: vi.fn(),
}));

vi.mock("@/lib/images", () => ({
  generateImage: mockGenerateImage,
  imageToBuffer: vi.fn(() => null),
  imageToPublicUrl: vi.fn((image: { directUrl?: string }) => image.directUrl ?? null),
}));

async function loadRoomStateModule() {
  return import("@/lib/server/room-state");
}

async function createLobbyState() {
  const { createRoomState } = await loadRoomStateModule();
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
      imageModel: "flux",
      promptModel: "flash",
      judgeModel: "flash",
      hintLimit: 0,
      totalRounds: 3,
      gameMode: "classic",
      cpuCount: 0,
    },
    ui: {
      theme: "neo-brutal",
    },
  });

  state.players.host = {
    uid: "host",
    displayName: "Host",
    kind: "human",
    isHost: true,
    joinedAt: now,
    expiresAt: dateAfterHours(24),
    lastSeenAt: now,
    ready: true,
    totalScore: 0,
  };

  state.players.guest = {
    uid: "guest",
    displayName: "Guest",
    kind: "human",
    isHost: false,
    joinedAt: now,
    expiresAt: dateAfterHours(24),
    lastSeenAt: now,
    ready: true,
    totalScore: 0,
  };

  return state;
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForPreparedSlot(roomId: string) {
  const { loadRoomState } = await loadRoomStateModule();

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const state = await loadRoomState(roomId);
    if (state?.preparedRound) {
      return state.preparedRound;
    }
    await sleep(20);
  }

  throw new Error("prepared round slot was not created in time");
}

describe("prepared round lifecycle", () => {
  beforeEach(async () => {
    vi.resetModules();
    const { __test__ } = await loadRoomStateModule();
    __test__.resetMemoryStore();
    mockGenerateGmPrompt.mockReset();
    mockGenerateImage.mockReset();

    mockGenerateGmPrompt.mockResolvedValue({
      title: "Paper fox",
      difficulty: 3,
      tags: ["paper", "fox", "market"],
      prompt: "A paper fox in a tiny market square, paper cut collage illustration, no text",
      negativePrompt: "",
      mustInclude: [],
      mustAvoid: [],
      stylePresetId: "paper-cut-collage",
    });
    mockGenerateImage.mockResolvedValue({
      mimeType: "image/png",
      directUrl: "https://example.com/generated-target.png",
    });
  });

  it("warms the next round into the prepared slot", async () => {
    const { loadRoomState, saveRoomState } = await loadRoomStateModule();
    await saveRoomState(await createLobbyState());
    const { ensurePreparedRound } = await import("@/lib/game/round-service");

    await ensurePreparedRound({ roomId: "ROOM1" });

    const state = await loadRoomState("ROOM1");
    expect(state?.preparedRound).toMatchObject({
      roundId: "round-1",
      index: 1,
      status: "READY",
      imageModel: "flux",
      gmTitle: "Paper fox",
      stylePresetId: "paper-cut-collage",
      targetImageUrl: "https://example.com/generated-target.png",
    });
    expect(state?.roundSequence).toBe(1);
    expect(state?.room.status).toBe("LOBBY");
  });

  it("consumes a prepared round without regenerating prompt or target image", async () => {
    const { loadRoomState, saveRoomState } = await loadRoomStateModule();
    await saveRoomState(await createLobbyState());
    const { ensurePreparedRound, startRound } = await import(
      "@/lib/game/round-service"
    );

    await ensurePreparedRound({ roomId: "ROOM1" });
    mockGenerateGmPrompt.mockClear();
    mockGenerateImage.mockClear();

    const result = await startRound({
      roomId: "ROOM1",
      uid: "host",
    });

    const state = await loadRoomState("ROOM1");
    expect(result).toEqual({
      roundId: "round-1",
      roundIndex: 1,
    });
    expect(state?.room.status).toBe("IN_ROUND");
    expect(state?.room.currentRoundId).toBe("round-1");
    expect(state?.preparedRound).toBeNull();
    expect(state?.roundPrivates["round-1"]?.stylePresetId).toBe(
      "paper-cut-collage",
    );
    expect(mockGenerateGmPrompt).not.toHaveBeenCalled();
    expect(mockGenerateImage).not.toHaveBeenCalled();
  });

  it("waits for an in-flight prepared round and reuses it without regenerating", async () => {
    const { loadRoomState, saveRoomState } = await loadRoomStateModule();
    await saveRoomState(await createLobbyState());

    let resolvePrompt:
      | ((value: {
          title: string;
          difficulty: number;
          tags: string[];
          prompt: string;
          negativePrompt: string;
          mustInclude: string[];
          mustAvoid: string[];
          stylePresetId: string;
        }) => void)
      | null = null;
    let resolveImage:
      | ((value: {
          mimeType: string;
          directUrl: string;
        }) => void)
      | null = null;

    mockGenerateGmPrompt.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePrompt = resolve;
        }),
    );
    mockGenerateImage.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveImage = resolve;
        }),
    );

    const { ensurePreparedRound, startRound } = await import(
      "@/lib/game/round-service"
    );

    const preparePromise = ensurePreparedRound({ roomId: "ROOM1" });
    await waitForPreparedSlot("ROOM1");

    const startPromise = startRound({
      roomId: "ROOM1",
      uid: "host",
    });

    await sleep(60);
    expect(mockGenerateGmPrompt).toHaveBeenCalledTimes(1);
    expect(mockGenerateImage).not.toHaveBeenCalled();

    expect(resolvePrompt).not.toBeNull();
    resolvePrompt!({
      title: "Paper fox",
      difficulty: 3,
      tags: ["paper", "fox", "market"],
      prompt: "A paper fox in a tiny market square, paper cut collage illustration, no text",
      negativePrompt: "",
      mustInclude: [],
      mustAvoid: [],
      stylePresetId: "paper-cut-collage",
    });

    await sleep(60);
    expect(mockGenerateImage).toHaveBeenCalledTimes(1);

    expect(resolveImage).not.toBeNull();
    resolveImage!({
      mimeType: "image/png",
      directUrl: "https://example.com/generated-target.png",
    });

    const result = await startPromise;
    await preparePromise;

    const latest = await loadRoomState("ROOM1");
    expect(result).toEqual({
      roundId: "round-1",
      roundIndex: 1,
    });
    expect(latest?.room.currentRoundId).toBe("round-1");
    expect(latest?.preparedRound).toBeNull();
    expect(mockGenerateGmPrompt).toHaveBeenCalledTimes(1);
    expect(mockGenerateImage).toHaveBeenCalledTimes(1);
  });

  it("falls back to synchronous generation when the prepared slot has already failed", async () => {
    const { loadRoomState, saveRoomState } = await loadRoomStateModule();
    const state = await createLobbyState();
    const now = new Date("2026-04-07T10:00:05.000Z");
    state.preparedRound = {
      roundId: "round-1",
      index: 1,
      status: "FAILED",
      createdAt: now,
      updatedAt: now,
      imageModel: "flux",
      gmPrompt: "",
      gmTitle: "Preparing...",
      gmTags: [],
      difficulty: 3,
      targetImageUrl: "",
      targetThumbUrl: "",
      errorMessage: "generation failed",
    };
    state.roundSequence = 1;
    await saveRoomState(state);

    const { startRound } = await import("@/lib/game/round-service");
    const result = await startRound({
      roomId: "ROOM1",
      uid: "host",
    });

    const latest = await loadRoomState("ROOM1");
    expect(result).toEqual({
      roundId: "round-2",
      roundIndex: 1,
    });
    expect(latest?.room.currentRoundId).toBe("round-2");
    expect(latest?.preparedRound).toBeNull();
  });

  it("keeps the round sequence across replay resets so the next replay gets a new round id", async () => {
    const { loadRoomState, saveRoomState } = await loadRoomStateModule();
    await saveRoomState(await createLobbyState());
    const { ensurePreparedRound, resetRoomForReplay, startRound } = await import(
      "@/lib/game/round-service"
    );

    await ensurePreparedRound({ roomId: "ROOM1" });
    await startRound({
      roomId: "ROOM1",
      uid: "host",
    });
    await resetRoomForReplay("ROOM1");
    await ensurePreparedRound({ roomId: "ROOM1" });

    const state = await loadRoomState("ROOM1");
    expect(state?.room.status).toBe("LOBBY");
    expect(state?.room.roundIndex).toBe(0);
    expect(state?.preparedRound?.roundId).toBe("round-2");
  });
});
