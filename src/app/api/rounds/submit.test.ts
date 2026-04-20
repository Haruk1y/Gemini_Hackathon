import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createRoomState,
  loadRoomState,
  saveRoomState,
  __test__ as roomStateTest,
} from "@/lib/server/room-state";
import { dateAfterHours } from "@/lib/utils/time";

const {
  mockGenerateImage,
  mockImageToBuffer,
  mockImageToPublicUrl,
  mockScoreImageSimilarity,
  mockUploadImageToStorage,
} = vi.hoisted(() => ({
  mockGenerateImage: vi.fn(),
  mockImageToBuffer: vi.fn(),
  mockImageToPublicUrl: vi.fn(),
  mockScoreImageSimilarity: vi.fn(),
  mockUploadImageToStorage: vi.fn(),
}));

vi.mock("@/lib/auth/verify-session", () => ({
  verifySessionCookie: vi.fn(() => ({
    uid: "anon_1",
    session: {
      uid: "anon_1",
      issuedAt: Date.now(),
    },
  })),
}));

vi.mock("@/lib/gemini/client", () => ({
  fallbackJudgeNote: (language: "ja" | "en") =>
    language === "ja"
      ? "画像の見た目比較で採点"
      : "Scored by visual similarity.",
  scoreImageSimilarity: mockScoreImageSimilarity,
}));

vi.mock("@/lib/images", () => ({
  generateImage: mockGenerateImage,
  imageToBuffer: mockImageToBuffer,
  imageToPublicUrl: mockImageToPublicUrl,
}));

vi.mock("@/lib/storage/upload-image", () => ({
  uploadImageToStorage: mockUploadImageToStorage,
}));

function createRoundState() {
  const now = new Date("2026-04-07T10:00:00.000Z");
  const state = createRoomState({
    roomId: "ROOM1",
    code: "ROOM1",
    createdAt: now,
    expiresAt: dateAfterHours(24),
    createdByUid: "anon_1",
    status: "IN_ROUND",
    currentRoundId: "round-1",
    roundIndex: 1,
    settings: {
      maxPlayers: 8,
      roundSeconds: 60,
      maxAttempts: 1,
      aspectRatio: "1:1",
      imageModel: "gemini",
      hintLimit: 0,
      totalRounds: 1,
      gameMode: "classic",
      cpuCount: 0,
    },
    ui: {
      theme: "neo-brutal",
    },
  });

  state.players.anon_1 = {
    uid: "anon_1",
    displayName: "Player",
    kind: "human",
    isHost: true,
    joinedAt: now,
    expiresAt: dateAfterHours(24),
    lastSeenAt: now,
    ready: true,
    totalScore: 0,
  };

  state.rounds["round-1"] = {
    roundId: "round-1",
    index: 1,
    status: "IN_ROUND",
    createdAt: now,
    expiresAt: dateAfterHours(24),
    startedAt: now,
    promptStartsAt: now,
    endsAt: new Date(now.getTime() + 60_000),
    targetImageUrl: "https://example.com/target.png",
    targetThumbUrl: "https://example.com/target.png",
    gmTitle: "Target",
    gmTags: [],
    difficulty: 3,
    reveal: {},
    stats: {
      submissions: 0,
      topScore: 0,
    },
  };

  state.roundPrivates["round-1"] = {
    roundId: "round-1",
    createdAt: now,
    expiresAt: dateAfterHours(24),
    gmPrompt: "gm prompt",
    gmNegativePrompt: "",
    safety: {
      blocked: false,
    },
  };

  return state;
}

function createRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/rounds/submit", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "session=placeholder; pmb_lang=en",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/rounds/submit reservations", () => {
  beforeEach(() => {
    roomStateTest.resetMemoryStore();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T10:00:05.000Z"));
    mockGenerateImage.mockReset();
    mockImageToBuffer.mockReset();
    mockImageToPublicUrl.mockReset();
    mockScoreImageSimilarity.mockReset();
    mockUploadImageToStorage.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(Buffer.from("target-image"), {
          status: 200,
          headers: {
            "content-type": "image/png",
          },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("stores a SCORING reservation before image generation finishes", async () => {
    await saveRoomState(createRoundState());

    let resolveImage!: (value: {
      mimeType: string;
      base64Data: string;
      directUrl?: string;
    }) => void;
    const imagePromise = new Promise<{
      mimeType: string;
      base64Data: string;
      directUrl?: string;
    }>((resolve) => {
      resolveImage = resolve;
    });

    mockGenerateImage.mockReturnValueOnce(imagePromise);
    mockImageToPublicUrl.mockReturnValue("https://example.com/generated.png");
    mockScoreImageSimilarity.mockResolvedValue({
      score: 88,
      matchedElements: ["subject"],
      missingElements: ["background"],
      note: "close match",
    });
    mockImageToBuffer.mockReturnValue(Buffer.from("generated-image"));
    mockUploadImageToStorage.mockResolvedValue(
      "https://blob.example/generated.png",
    );

    const { POST } = await import("@/app/api/rounds/submit/route");
    const responsePromise = POST(
      createRequest({
        roomId: "ROOM1",
        roundId: "round-1",
        prompt: "prompt text",
      }),
    );

    let reservedState = await loadRoomState("ROOM1");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (reservedState?.attempts["round-1"]?.anon_1) {
        break;
      }
      await Promise.resolve();
      reservedState = await loadRoomState("ROOM1");
    }

    expect(
      reservedState?.attempts["round-1"]?.anon_1?.attempts[0],
    ).toMatchObject({
      attemptNo: 1,
      prompt: "prompt text",
      imageUrl: "",
      score: null,
      status: "SCORING",
    });

    resolveImage({
      mimeType: "image/png",
      base64Data: Buffer.from("generated-image").toString("base64"),
      directUrl: "https://example.com/generated.png",
    });

    const response = await responsePromise;
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      attemptNo: 1,
      score: 88,
    });
  });

  it("rolls back a reserved attempt after generation failure and allows retry", async () => {
    await saveRoomState(createRoundState());

    mockGenerateImage
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({
        mimeType: "image/png",
        base64Data: Buffer.from("generated-image").toString("base64"),
        directUrl: "https://example.com/generated.png",
      });
    mockImageToPublicUrl.mockReturnValue("https://example.com/generated.png");
    mockScoreImageSimilarity.mockResolvedValue({
      score: 91,
      matchedElements: ["subject"],
      missingElements: [],
      note: "great match",
    });
    mockImageToBuffer.mockReturnValue(Buffer.from("generated-image"));
    mockUploadImageToStorage.mockResolvedValue(
      "https://blob.example/generated.png",
    );

    const { POST } = await import("@/app/api/rounds/submit/route");
    const failureResponse = await POST(
      createRequest({
        roomId: "ROOM1",
        roundId: "round-1",
        prompt: "prompt text",
      }),
    );

    expect(failureResponse.status).toBe(500);
    await expect(failureResponse.json()).resolves.toMatchObject({
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
      },
    });

    const stateAfterFailure = await loadRoomState("ROOM1");
    expect(stateAfterFailure?.attempts["round-1"]?.anon_1).toBeUndefined();
    expect(stateAfterFailure?.scores["round-1"]?.anon_1).toBeUndefined();

    const successResponse = await POST(
      createRequest({
        roomId: "ROOM1",
        roundId: "round-1",
        prompt: "prompt text",
      }),
    );

    expect(successResponse.status).toBe(200);
    await expect(successResponse.json()).resolves.toMatchObject({
      ok: true,
      attemptNo: 1,
      score: 91,
      imageUrl: "https://blob.example/generated.png",
    });

    const stateAfterRetry = await loadRoomState("ROOM1");
    expect(
      stateAfterRetry?.attempts["round-1"]?.anon_1?.attempts[0],
    ).toMatchObject({
      attemptNo: 1,
      status: "DONE",
      score: 91,
      imageUrl: "https://blob.example/generated.png",
    });
    expect(stateAfterRetry?.scores["round-1"]?.anon_1?.bestScore).toBe(91);
  });

  it("passes the active language into visual scoring", async () => {
    await saveRoomState(createRoundState());

    mockGenerateImage.mockResolvedValueOnce({
      mimeType: "image/png",
      base64Data: Buffer.from("generated-image").toString("base64"),
      directUrl: "https://example.com/generated.png",
    });
    mockImageToPublicUrl.mockReturnValue("https://example.com/generated.png");
    mockScoreImageSimilarity.mockResolvedValue({
      score: 88,
      matchedElements: ["subject"],
      missingElements: [],
      note: "close match",
    });
    mockImageToBuffer.mockReturnValue(Buffer.from("generated-image"));
    mockUploadImageToStorage.mockResolvedValue(
      "https://blob.example/generated.png",
    );

    const { POST } = await import("@/app/api/rounds/submit/route");
    const response = await POST(
      new NextRequest("http://localhost/api/rounds/submit", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "session=placeholder; pmb_lang=ja",
        },
        body: JSON.stringify({
          roomId: "ROOM1",
          roundId: "round-1",
          prompt: "prompt text",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockScoreImageSimilarity).toHaveBeenCalledWith(
      expect.objectContaining({
        language: "ja",
      }),
    );
  });

  it("uses a localized fallback judge note when Gemini returns an empty note", async () => {
    await saveRoomState(createRoundState());

    mockGenerateImage.mockResolvedValueOnce({
      mimeType: "image/png",
      base64Data: Buffer.from("generated-image").toString("base64"),
      directUrl: "https://example.com/generated.png",
    });
    mockImageToPublicUrl.mockReturnValue("https://example.com/generated.png");
    mockScoreImageSimilarity.mockResolvedValue({
      score: 88,
      matchedElements: ["subject"],
      missingElements: [],
      note: "",
    });
    mockImageToBuffer.mockReturnValue(Buffer.from("generated-image"));
    mockUploadImageToStorage.mockResolvedValue(
      "https://blob.example/generated.png",
    );

    const { POST } = await import("@/app/api/rounds/submit/route");
    const response = await POST(
      new NextRequest("http://localhost/api/rounds/submit", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "session=placeholder; pmb_lang=ja",
        },
        body: JSON.stringify({
          roomId: "ROOM1",
          roundId: "round-1",
          prompt: "prompt text",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      judgeNote: "画像の見た目比較で採点",
    });

    const updatedState = await loadRoomState("ROOM1");
    expect(
      updatedState?.attempts["round-1"]?.anon_1?.attempts[0]?.judgeNote,
    ).toBe("画像の見た目比較で採点");
  });

  it("logs the image generation stage when image generation fails", async () => {
    await saveRoomState(createRoundState());
    mockGenerateImage.mockRejectedValueOnce(
      new Error("generation backend exploded"),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const { POST } = await import("@/app/api/rounds/submit/route");
    const response = await POST(
      createRequest({
        roomId: "ROOM1",
        roundId: "round-1",
        prompt: "prompt text",
      }),
    );

    expect(response.status).toBe(500);
    expect(consoleError).toHaveBeenCalledWith(
      "round submit stage failed",
      expect.objectContaining({
        stage: "image_generation",
        roomId: "ROOM1",
        roundId: "round-1",
        uid: "anon_1",
      }),
    );

    consoleError.mockRestore();
  });

  it("logs the visual scoring stage when judging fails", async () => {
    await saveRoomState(createRoundState());
    mockGenerateImage.mockResolvedValueOnce({
      mimeType: "image/png",
      base64Data: Buffer.from("generated-image").toString("base64"),
      directUrl: "https://example.com/generated.png",
    });
    mockImageToPublicUrl.mockReturnValue("https://example.com/generated.png");
    mockScoreImageSimilarity.mockRejectedValueOnce(
      new Error("judge backend exploded"),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const { POST } = await import("@/app/api/rounds/submit/route");
    const response = await POST(
      createRequest({
        roomId: "ROOM1",
        roundId: "round-1",
        prompt: "prompt text",
      }),
    );

    expect(response.status).toBe(500);
    expect(consoleError).toHaveBeenCalledWith(
      "round submit stage failed",
      expect.objectContaining({
        stage: "visual_scoring",
        roomId: "ROOM1",
        roundId: "round-1",
        uid: "anon_1",
      }),
    );

    consoleError.mockRestore();
  });
});
