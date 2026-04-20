import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IMPOSTOR_TIMEOUT_PROMPT } from "@/lib/game/impostor";
import { createRoomState, loadRoomState, saveRoomState, __test__ as roomStateTest } from "@/lib/server/room-state";
import { dateAfterHours, parseDate } from "@/lib/utils/time";

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
  imageToPublicUrl: vi.fn((image: { directUrl?: string }) => image.directUrl ?? null),
}));

function dataUrl(label: string) {
  return `data:image/png;base64,${Buffer.from(label).toString("base64")}`;
}

function createDeferredPromise<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

function createLobbyState(cpuCount = 1) {
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
      totalRounds: 3,
      gameMode: "impostor",
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
  state.players.guest = {
    uid: "guest",
    displayName: "Guest",
    kind: "human",
    seatOrder: 1,
    isHost: false,
    joinedAt: now,
    expiresAt: dateAfterHours(24),
    lastSeenAt: now,
    ready: true,
    totalScore: 0,
  };

  return state;
}

function seedCpuPlayer(
  state: ReturnType<typeof createLobbyState>,
  index: number,
  seatOrder: number,
) {
  const now = new Date("2026-04-07T10:00:00.000Z");
  state.players[`cpu-${index}`] = {
    uid: `cpu-${index}`,
    displayName: `CPU ${index}`,
    kind: "cpu",
    seatOrder,
    isHost: false,
    joinedAt: now,
    expiresAt: dateAfterHours(24),
    lastSeenAt: now,
    ready: true,
    totalScore: 0,
  };
}

describe("impostor round lifecycle", () => {
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
      tags: ["tag-a", "tag-b"],
      prompt: "original prompt with enough detail",
      negativePrompt: "",
      mustInclude: [],
      mustAvoid: [],
    });
    mockGenerateImage.mockImplementation(async ({ prompt }: { prompt: string }) => ({
      mimeType: "image/png",
      directUrl: dataUrl(prompt),
    }));
    mockCaptionFromImage.mockResolvedValue({
      scene: "image scene",
      mainSubjects: ["subject"],
      keyObjects: ["object"],
      colors: ["red"],
      style: "stylized",
      composition: "balanced composition",
      textInImage: null,
    });
    mockRewriteCpuPrompt.mockResolvedValue("cpu rewritten prompt with moderate human drift");
    mockScoreImageSimilarity.mockResolvedValue({
      score: 58,
      matchedElements: ["subject"],
      missingElements: ["background"],
      note: "mock score",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes a human prompt through to generateImage and stores the same prompt on the turn record", async () => {
    const lobbyState = createLobbyState(0);
    await saveRoomState(lobbyState);

    const distinctivePrompt =
      "neon koi swimming through a glass subway tunnel under tokyo, cinematic rain, ultra detailed";

    const { startRound, submitImpostorTurn } = await import("@/lib/game/round-service");
    await startRound({
      roomId: "ROOM1",
      uid: "host",
    });

    await submitImpostorTurn({
      roomId: "ROOM1",
      roundId: "round-1",
      uid: "host",
      prompt: distinctivePrompt,
    });

    const state = await loadRoomState("ROOM1");
    const turnRecord = state?.roundPrivates["round-1"]?.modeState?.turnRecords[0];

    expect(mockGenerateImage).toHaveBeenCalledTimes(2);
    expect(mockGenerateImage.mock.calls[1]?.[0]).toMatchObject({
      prompt: distinctivePrompt,
      aspectRatio: "1:1",
    });
    expect(turnRecord?.uid).toBe("host");
    expect(turnRecord?.prompt).toBe(distinctivePrompt);
    expect(turnRecord?.imageUrl).toBe(dataUrl(distinctivePrompt));
    expect(turnRecord?.timedOut).not.toBe(true);
    expect(turnRecord?.prompt).not.toBe(IMPOSTOR_TIMEOUT_PROMPT);
  });

  it("uses the dreamlike fallback only when a human turn times out", async () => {
    const lobbyState = createLobbyState(0);
    await saveRoomState(lobbyState);

    const { endRoundIfNeeded, startRound } = await import("@/lib/game/round-service");
    await startRound({
      roomId: "ROOM1",
      uid: "host",
    });

    const activeState = await loadRoomState("ROOM1");
    const activeRound = activeState?.rounds["round-1"];
    expect(activeRound?.modeState?.currentTurnUid).toBe("host");

    if (!activeState || !activeRound) {
      throw new Error("round-1 should exist after startRound");
    }

    activeRound.endsAt = new Date(Date.now() - 1_000);
    await saveRoomState(activeState);

    const result = await endRoundIfNeeded({
      roomId: "ROOM1",
      roundId: "round-1",
    });

    const nextState = await loadRoomState("ROOM1");
    const turnRecord = nextState?.roundPrivates["round-1"]?.modeState?.turnRecords[0];
    const round = nextState?.rounds["round-1"];

    expect(result.status).toBe("IN_ROUND");
    expect(mockGenerateImage).toHaveBeenCalledTimes(2);
    expect(mockGenerateImage.mock.calls[1]?.[0]).toMatchObject({
      prompt: IMPOSTOR_TIMEOUT_PROMPT,
      aspectRatio: "1:1",
    });
    expect(turnRecord?.uid).toBe("host");
    expect(turnRecord?.prompt).toBe(IMPOSTOR_TIMEOUT_PROMPT);
    expect(turnRecord?.imageUrl).toBe(dataUrl(IMPOSTOR_TIMEOUT_PROMPT));
    expect(turnRecord?.timedOut).toBe(true);
    expect(round?.modeState?.currentTurnUid).toBe("guest");
  });

  it("uses the current human draft when a human turn times out", async () => {
    const lobbyState = createLobbyState(0);
    await saveRoomState(lobbyState);

    const { endRoundIfNeeded, startRound } = await import("@/lib/game/round-service");
    await startRound({
      roomId: "ROOM1",
      uid: "host",
    });

    const activeState = await loadRoomState("ROOM1");
    const activeRound = activeState?.rounds["round-1"];
    expect(activeRound?.modeState?.currentTurnUid).toBe("host");

    if (!activeState || !activeRound) {
      throw new Error("round-1 should exist after startRound");
    }

    activeRound.endsAt = new Date(Date.now() - 1_000);
    await saveRoomState(activeState);

    const result = await endRoundIfNeeded({
      roomId: "ROOM1",
      roundId: "round-1",
      uid: "host",
      draftPrompt: "partial timeout draft",
    });

    const nextState = await loadRoomState("ROOM1");
    const turnRecord = nextState?.roundPrivates["round-1"]?.modeState?.turnRecords[0];
    const round = nextState?.rounds["round-1"];

    expect(result).toMatchObject({
      status: "IN_ROUND",
      consumedDraft: true,
    });
    expect(mockGenerateImage).toHaveBeenCalledTimes(2);
    expect(mockGenerateImage.mock.calls[1]?.[0]).toMatchObject({
      prompt: "partial timeout draft",
      aspectRatio: "1:1",
    });
    expect(turnRecord?.uid).toBe("host");
    expect(turnRecord?.prompt).toBe("partial timeout draft");
    expect(turnRecord?.imageUrl).toBe(dataUrl("partial timeout draft"));
    expect(turnRecord?.timedOut).toBe(true);
    expect(round?.modeState?.currentTurnUid).toBe("guest");
  });

  it("falls back to the local reconstructed prompt when cpu rewrite returns nothing", async () => {
    const lobbyState = createLobbyState();
    lobbyState.players.host.seatOrder = 1;
    lobbyState.players.guest.seatOrder = 2;
    seedCpuPlayer(lobbyState, 1, 0);
    await saveRoomState(lobbyState);
    mockRewriteCpuPrompt.mockResolvedValueOnce(null);

    const { startRound } = await import("@/lib/game/round-service");
    await startRound({
      roomId: "ROOM1",
      uid: "host",
    });

    const state = await loadRoomState("ROOM1");
    const turnRecord = state?.roundPrivates["round-1"]?.modeState?.turnRecords[0];
    const cpuGenerateCall = mockGenerateImage.mock.calls[1]?.[0];

    expect(cpuGenerateCall).toMatchObject({
      aspectRatio: "1:1",
    });
    expect(cpuGenerateCall).not.toHaveProperty("sourceImage");
    expect(cpuGenerateCall?.prompt).toContain("image scene");
    expect(turnRecord?.prompt).toContain("image scene");
  });

  it("returns from startRound before the first cpu turn completes when a scheduler is provided", async () => {
    const lobbyState = createLobbyState();
    lobbyState.players.host.seatOrder = 1;
    lobbyState.players.guest.seatOrder = 2;
    seedCpuPlayer(lobbyState, 1, 0);
    await saveRoomState(lobbyState);

    const deferredCpuImage = createDeferredPromise<{ mimeType: string; directUrl: string }>();
    let imageCallCount = 0;
    mockGenerateImage.mockImplementation(async ({ prompt }: { prompt: string }) => {
      imageCallCount += 1;
      if (imageCallCount === 1) {
        return {
          mimeType: "image/png",
          directUrl: dataUrl(prompt),
        };
      }

      return deferredCpuImage.promise;
    });

    const scheduledRuns: Array<{ roomId: string; roundId: string }> = [];
    const { runImpostorCpuTurns, startRound } = await import("@/lib/game/round-service");
    const result = await startRound({
      roomId: "ROOM1",
      uid: "host",
      scheduleCpuTurns: async (scheduled) => {
        scheduledRuns.push(scheduled);
      },
    });

    expect(result).toEqual({
      roundId: "round-1",
      roundIndex: 1,
    });
    expect(scheduledRuns).toEqual([
      {
        roomId: "ROOM1",
        roundId: "round-1",
      },
    ]);

    const scheduledState = await loadRoomState("ROOM1");
    const scheduledRound = scheduledState?.rounds["round-1"];

    expect(scheduledRound?.modeState?.currentTurnUid).toBe("cpu-1");
    expect(scheduledRound?.endsAt).toBeNull();
    expect(scheduledState?.roundPrivates["round-1"]?.modeState?.turnRecords).toHaveLength(0);

    const cpuRunPromise = runImpostorCpuTurns(scheduledRuns[0]!);

    deferredCpuImage.resolve({
      mimeType: "image/png",
      directUrl: dataUrl("cpu scheduled"),
    });
    await cpuRunPromise;

    const completedState = await loadRoomState("ROOM1");
    const completedRound = completedState?.rounds["round-1"];

    expect(completedRound?.modeState?.currentTurnUid).toBe("host");
    expect(completedState?.roundPrivates["round-1"]?.modeState?.turnRecords).toHaveLength(1);
  });

  it("auto-runs the first cpu turn and hands the chain to the next human", async () => {
    const lobbyState = createLobbyState();
    lobbyState.players.host.seatOrder = 1;
    lobbyState.players.guest.seatOrder = 2;
    seedCpuPlayer(lobbyState, 1, 0);
    await saveRoomState(lobbyState);

    const deferredCpuImage = createDeferredPromise<{ mimeType: string; directUrl: string }>();
    let imageCallCount = 0;
    mockGenerateImage.mockImplementation(async ({ prompt }: { prompt: string }) => {
      imageCallCount += 1;
      if (imageCallCount === 1) {
        return {
          mimeType: "image/png",
          directUrl: dataUrl(prompt),
        };
      }

      return deferredCpuImage.promise;
    });

    const sequence = [0.6, 0.1, 0.1];
    const randomSpy = vi.spyOn(Math, "random").mockImplementation(() => sequence.shift() ?? 0.1);

    const { startRound } = await import("@/lib/game/round-service");
    const startPromise = startRound({
      roomId: "ROOM1",
      uid: "host",
    });

    let cpuTurnObserved = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const activeState = await loadRoomState("ROOM1");
      if (activeState?.rounds["round-1"]?.modeState?.currentTurnUid === "cpu-1") {
        expect(activeState.rounds["round-1"]?.endsAt).toBeNull();
        cpuTurnObserved = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(cpuTurnObserved).toBe(true);

    deferredCpuImage.resolve({
      mimeType: "image/png",
      directUrl: dataUrl("cpu immediate"),
    });
    await startPromise;

    randomSpy.mockRestore();

    const state = await loadRoomState("ROOM1");
    const round = state?.rounds["round-1"];
    const roundPrivate = state?.roundPrivates["round-1"];

    expect(state?.room.status).toBe("IN_ROUND");
    expect(state?.players["cpu-1"]?.kind).toBe("cpu");
    expect(mockGenerateImage.mock.calls[1]?.[0]).toMatchObject({
      prompt: "cpu rewritten prompt with moderate human drift",
      aspectRatio: "1:1",
    });
    expect(mockGenerateImage.mock.calls[1]?.[0]).not.toHaveProperty("sourceImage");
    expect(round?.modeState?.kind).toBe("impostor");
    expect(round?.modeState?.turnOrder).toEqual(["cpu-1", "host", "guest"]);
    expect(round?.modeState?.currentTurnIndex).toBe(1);
    expect(round?.modeState?.currentTurnUid).toBe("host");
    expect(roundPrivate?.modeState?.turnRecords).toHaveLength(1);
    expect(roundPrivate?.modeState?.turnRecords[0]?.uid).toBe("cpu-1");
    expect(roundPrivate?.modeState?.turnRecords[0]?.prompt).toBe("cpu rewritten prompt with moderate human drift");
    expect(parseDate(round?.endsAt)?.getTime()).toBeGreaterThan(Date.now());
  });

  it("returns from submitImpostorTurn before the next cpu turn completes when a scheduler is provided", async () => {
    const lobbyState = createLobbyState();
    lobbyState.players.guest.seatOrder = 2;
    seedCpuPlayer(lobbyState, 1, 1);
    await saveRoomState(lobbyState);

    let imageCallCount = 0;
    const deferredCpuImage = createDeferredPromise<{ mimeType: string; directUrl: string }>();
    mockGenerateImage.mockImplementation(async ({ prompt }: { prompt: string }) => {
      imageCallCount += 1;
      if (imageCallCount < 3) {
        return {
          mimeType: "image/png",
          directUrl: dataUrl(prompt),
        };
      }

      return deferredCpuImage.promise;
    });

    const scheduledRuns: Array<{ roomId: string; roundId: string }> = [];
    const { runImpostorCpuTurns, startRound, submitImpostorTurn } = await import("@/lib/game/round-service");
    await startRound({
      roomId: "ROOM1",
      uid: "host",
    });

    await submitImpostorTurn({
      roomId: "ROOM1",
      roundId: "round-1",
      uid: "host",
      prompt: "human pass to cpu",
      scheduleCpuTurns: async (scheduled) => {
        scheduledRuns.push(scheduled);
      },
    });

    expect(scheduledRuns).toEqual([
      {
        roomId: "ROOM1",
        roundId: "round-1",
      },
    ]);

    const scheduledState = await loadRoomState("ROOM1");
    const scheduledRound = scheduledState?.rounds["round-1"];
    const scheduledRecords = scheduledState?.roundPrivates["round-1"]?.modeState?.turnRecords ?? [];

    expect(scheduledRound?.modeState?.currentTurnUid).toBe("cpu-1");
    expect(scheduledRecords).toHaveLength(1);
    expect(scheduledRecords[0]?.uid).toBe("host");

    const cpuRunPromise = runImpostorCpuTurns(scheduledRuns[0]!);

    deferredCpuImage.resolve({
      mimeType: "image/png",
      directUrl: dataUrl("cpu after submit"),
    });
    await cpuRunPromise;

    const completedState = await loadRoomState("ROOM1");
    const completedRound = completedState?.rounds["round-1"];
    const completedRecords = completedState?.roundPrivates["round-1"]?.modeState?.turnRecords ?? [];

    expect(completedRound?.modeState?.currentTurnUid).toBe("guest");
    expect(completedRecords.map((record) => record.uid)).toEqual(["host", "cpu-1"]);
  });

  it("auto-runs the next cpu turn immediately after a human submit", async () => {
    const lobbyState = createLobbyState();
    lobbyState.players.guest.seatOrder = 2;
    seedCpuPlayer(lobbyState, 1, 1);
    await saveRoomState(lobbyState);

    const sequence = [0.5, 0.9, 0.1];
    const randomSpy = vi.spyOn(Math, "random").mockImplementation(() => sequence.shift() ?? 0.1);

    const { startRound, submitImpostorTurn } = await import("@/lib/game/round-service");
    await startRound({
      roomId: "ROOM1",
      uid: "host",
    });

    await submitImpostorTurn({
      roomId: "ROOM1",
      roundId: "round-1",
      uid: "host",
      prompt: "human pass to cpu",
    });

    randomSpy.mockRestore();

    const state = await loadRoomState("ROOM1");
    const round = state?.rounds["round-1"];
    const turnRecords = state?.roundPrivates["round-1"]?.modeState?.turnRecords ?? [];

    expect(round?.modeState?.turnOrder).toEqual(["host", "cpu-1", "guest"]);
    expect(round?.modeState?.currentTurnIndex).toBe(2);
    expect(round?.modeState?.currentTurnUid).toBe("guest");
    expect(turnRecords).toHaveLength(2);
    expect(turnRecords[0]?.uid).toBe("host");
    expect(turnRecords[1]?.uid).toBe("cpu-1");
    expect(parseDate(round?.endsAt)?.getTime()).toBeGreaterThan(Date.now());
  });

  it("returns from endRoundIfNeeded before the scheduled cpu follow-up completes", async () => {
    const lobbyState = createLobbyState();
    lobbyState.players.guest.seatOrder = 2;
    seedCpuPlayer(lobbyState, 1, 1);
    await saveRoomState(lobbyState);

    let imageCallCount = 0;
    const deferredCpuImage = createDeferredPromise<{ mimeType: string; directUrl: string }>();
    mockGenerateImage.mockImplementation(async ({ prompt }: { prompt: string }) => {
      imageCallCount += 1;
      if (imageCallCount < 3) {
        return {
          mimeType: "image/png",
          directUrl: dataUrl(prompt),
        };
      }

      return deferredCpuImage.promise;
    });

    const scheduledRuns: Array<{ roomId: string; roundId: string }> = [];
    const { endRoundIfNeeded, runImpostorCpuTurns, startRound } = await import("@/lib/game/round-service");
    await startRound({
      roomId: "ROOM1",
      uid: "host",
    });

    const activeState = await loadRoomState("ROOM1");
    const activeRound = activeState?.rounds["round-1"];
    if (!activeState || !activeRound) {
      throw new Error("round-1 should exist before timeout scheduling");
    }

    activeRound.endsAt = new Date(Date.now() - 1_000);
    await saveRoomState(activeState);

    const result = await endRoundIfNeeded({
      roomId: "ROOM1",
      roundId: "round-1",
      scheduleCpuTurns: async (scheduled) => {
        scheduledRuns.push(scheduled);
      },
    });

    expect(result.status).toBe("IN_ROUND");
    expect(scheduledRuns).toEqual([
      {
        roomId: "ROOM1",
        roundId: "round-1",
      },
    ]);

    const scheduledState = await loadRoomState("ROOM1");
    const scheduledRound = scheduledState?.rounds["round-1"];
    const scheduledRecords = scheduledState?.roundPrivates["round-1"]?.modeState?.turnRecords ?? [];

    expect(scheduledRound?.modeState?.currentTurnUid).toBe("cpu-1");
    expect(scheduledRecords).toHaveLength(1);
    expect(scheduledRecords[0]?.prompt).toBe(IMPOSTOR_TIMEOUT_PROMPT);
    expect(scheduledRecords[0]?.timedOut).toBe(true);

    const cpuRunPromise = runImpostorCpuTurns(scheduledRuns[0]!);

    deferredCpuImage.resolve({
      mimeType: "image/png",
      directUrl: dataUrl("cpu after timeout"),
    });
    await cpuRunPromise;

    const completedState = await loadRoomState("ROOM1");
    const completedRound = completedState?.rounds["round-1"];
    const completedRecords = completedState?.roundPrivates["round-1"]?.modeState?.turnRecords ?? [];

    expect(completedRound?.modeState?.currentTurnUid).toBe("guest");
    expect(completedRecords.map((record) => record.uid)).toEqual(["host", "cpu-1"]);
  });

  it("auto-runs consecutive cpu turns without waiting for roundSeconds", async () => {
    const lobbyState = createLobbyState(2);
    lobbyState.players.guest.seatOrder = 3;
    seedCpuPlayer(lobbyState, 1, 1);
    seedCpuPlayer(lobbyState, 2, 2);
    await saveRoomState(lobbyState);

    const sequence = [0.3, 0.4, 0.9, 0.1];
    const randomSpy = vi.spyOn(Math, "random").mockImplementation(() => sequence.shift() ?? 0.1);

    const { startRound, submitImpostorTurn } = await import("@/lib/game/round-service");
    await startRound({
      roomId: "ROOM1",
      uid: "host",
    });

    await submitImpostorTurn({
      roomId: "ROOM1",
      roundId: "round-1",
      uid: "host",
      prompt: "human pass to cpu chain",
    });

    randomSpy.mockRestore();

    const state = await loadRoomState("ROOM1");
    const round = state?.rounds["round-1"];
    const turnRecords = state?.roundPrivates["round-1"]?.modeState?.turnRecords ?? [];

    expect(state?.players["cpu-1"]?.kind).toBe("cpu");
    expect(state?.players["cpu-2"]?.kind).toBe("cpu");
    expect(round?.modeState?.turnOrder).toEqual(["host", "cpu-1", "cpu-2", "guest"]);
    expect(round?.modeState?.currentTurnIndex).toBe(3);
    expect(round?.modeState?.currentTurnUid).toBe("guest");
    expect(turnRecords).toHaveLength(3);
    expect(turnRecords.map((record) => record.uid)).toEqual(["host", "cpu-1", "cpu-2"]);
    expect(parseDate(round?.endsAt)?.getTime()).toBeGreaterThan(Date.now());
  });
});
