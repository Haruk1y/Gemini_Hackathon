// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import RoundPage from "@/app/round/[roomId]/page";
import { LanguageProvider } from "@/components/providers/language-provider";

const {
  apiPostMock,
  pushMock,
  replaceMock,
  roundSnapshot,
  useRoomPresenceMock,
} = vi.hoisted(() => {
  const now = Date.now();

  return {
    apiPostMock: vi.fn(),
    pushMock: vi.fn(),
    replaceMock: vi.fn(),
    roundSnapshot: {
      room: {
        status: "IN_ROUND",
        currentRoundId: "round-1",
        settings: {
          gameMode: "change",
          roundSeconds: 20,
          maxAttempts: 1,
          hintLimit: 0,
          imageModel: "flux",
          promptModel: "flash-lite",
          judgeModel: "flash-lite",
          cpuCount: 0,
        },
      },
      round: {
        roundId: "round-1",
        index: 1,
        status: "IN_ROUND",
        promptStartsAt: new Date(now - 21_000).toISOString(),
        endsAt: new Date(now + 9_000).toISOString(),
        targetImageUrl: "https://example.com/base.png",
        targetThumbUrl: "https://example.com/base.png",
        gmTitle: "Aha Check",
        gmTags: ["change"],
        difficulty: 2,
        reveal: {},
        stats: {
          submissions: 1,
          topScore: 100,
        },
        modeState: {
          kind: "change",
          baseImageUrl: "https://example.com/base.png",
          changedImageUrl: "https://example.com/changed.png",
          submittedCount: 1,
          correctCount: 1,
        },
      },
      scores: [],
      attempts: null,
      mySubmission: {
        uid: "host",
        displayName: "Host",
        kind: "human",
        point: { x: 0.5, y: 0.5 },
        hit: true,
        score: 100,
        rank: 1,
        createdAt: new Date(now - 1_000).toISOString(),
      },
      players: [
        {
          uid: "host",
          displayName: "Host",
          kind: "human",
          ready: true,
          isHost: true,
          totalScore: 100,
        },
      ],
      playerCount: 1,
      myRole: null,
      isMyTurn: false,
      currentTurnUid: null,
      turnTimeline: [],
    },
    useRoomPresenceMock: vi.fn(),
  };
});

vi.mock("next/navigation", () => ({
  useParams: () => ({
    roomId: "ROOM1",
  }),
  useRouter: () => ({
    push: pushMock,
    replace: replaceMock,
  }),
}));

vi.mock("@/components/providers/auth-provider", () => ({
  useAuth: () => ({
    user: {
      uid: "host",
      issuedAt: "2026-04-22T00:00:00.000Z",
    },
  }),
}));

vi.mock("@/lib/client/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client/api")>();
  return {
    ...actual,
    apiPost: (path: string, body: Record<string, unknown>) =>
      apiPostMock(path, body),
  };
});

vi.mock("@/lib/client/room-presence", () => ({
  useRoomPresence: (params: unknown) => useRoomPresenceMock(params),
}));

vi.mock("@/lib/client/room-sync", () => ({
  useRoomSync: () => ({ snapshot: roundSnapshot }),
}));

describe("RoundPage Aha results shortcut", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("forces Aha results before navigating from the round screen", async () => {
    apiPostMock.mockResolvedValue({ ok: true, status: "RESULTS" });

    const user = userEvent.setup();
    render(
      <LanguageProvider initialLanguage="en">
        <RoundPage />
      </LanguageProvider>,
    );

    const button = await screen.findByRole("button", {
      name: /Go to results/i,
    });
    await user.click(button);

    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalledWith("/api/rounds/endIfNeeded", {
        roomId: "ROOM1",
        roundId: "round-1",
        forceResults: true,
      });
    });
    expect(pushMock).toHaveBeenCalledWith("/results/ROOM1");
  });
});
