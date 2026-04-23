// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ResultsPage from "@/app/results/[roomId]/page";
import { LanguageProvider } from "@/components/providers/language-provider";

const {
  replaceMock,
  pushMock,
  useRoomSyncMock,
  useRoomPresenceMock,
  apiPostMock,
  authStateRef,
} = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  pushMock: vi.fn(),
  useRoomSyncMock: vi.fn(),
  useRoomPresenceMock: vi.fn(),
  apiPostMock: vi.fn(),
  authStateRef: {
    current: {
      user: {
        uid: "guest",
        issuedAt: "2026-04-22T00:00:00.000Z",
      },
    },
  },
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({
    roomId: "ROOM1",
  }),
  useRouter: () => ({
    push: pushMock,
    replace: replaceMock,
  }),
  useSearchParams: () => ({
    get: () => null,
  }),
}));

vi.mock("@/components/providers/auth-provider", () => ({
  useAuth: () => ({
    user: authStateRef.current.user,
    loading: false,
    error: null,
  }),
}));

vi.mock("@/lib/client/api", () => ({
  apiPost: (path: string, body: Record<string, unknown>) => apiPostMock(path, body),
}));

vi.mock("@/lib/client/room-sync", () => ({
  useRoomSync: (params: unknown) => useRoomSyncMock(params),
}));

vi.mock("@/lib/client/room-presence", () => ({
  useRoomPresence: (params: unknown) => useRoomPresenceMock(params),
}));

vi.mock("@/components/game/podium", () => ({
  Podium: ({
    entries,
  }: {
    entries: Array<{ displayName: string }>;
  }) => <div data-testid="podium">{entries.map((entry) => entry.displayName).join(", ")}</div>,
}));

function createResultsSnapshot(params?: {
  roomStatus?: "RESULTS" | "LOBBY";
  includeRound?: boolean;
  roundIndex?: number;
  totalRounds?: number;
}) {
  const includeRound = params?.includeRound ?? true;

  return {
    room: {
      status: params?.roomStatus ?? "RESULTS",
      currentRoundId: includeRound ? "round-1" : null,
      roundIndex: params?.roundIndex ?? 1,
      settings: {
        gameMode: "classic" as const,
        imageModel: "gemini" as const,
        promptModel: "flash-lite" as const,
        judgeModel: "flash-lite" as const,
        totalRounds: params?.totalRounds ?? 1,
        cpuCount: 0,
      },
    },
    round: includeRound
      ? {
          roundId: "round-1",
          index: params?.roundIndex ?? 1,
          status: "RESULTS" as const,
          targetImageUrl: "https://example.com/target.png",
          targetThumbUrl: "https://example.com/target.png",
          gmTitle: "Original",
          gmTags: [],
          reveal: {
            gmPromptPublic: "prompt text",
          },
          endsAt: "2026-04-22T00:00:00.000Z",
          createdAt: "2026-04-22T00:00:00.000Z",
          expiresAt: "2026-04-23T00:00:00.000Z",
          startedAt: "2026-04-22T00:00:00.000Z",
          promptStartsAt: "2026-04-22T00:00:00.000Z",
          difficulty: 3 as const,
          stats: {
            submissions: 2,
            topScore: 91,
          },
        }
      : null,
    scores: [
      {
        uid: "host",
        displayName: "Host",
        bestScore: 91,
        bestImageUrl: "https://example.com/host.png",
      },
      {
        uid: "guest",
        displayName: "Guest",
        bestScore: 88,
        bestImageUrl: "https://example.com/guest.png",
      },
    ],
    players: [
      {
        uid: "host",
        displayName: "Host",
        kind: "human" as const,
        ready: false,
        isHost: true,
        totalScore: 91,
      },
      {
        uid: "guest",
        displayName: "Guest",
        kind: "human" as const,
        ready: false,
        isHost: false,
        totalScore: 88,
      },
    ],
    attempts: null,
    myAttempts: null,
    voteProgress: null,
    finalSimilarityScore: null,
    turnTimeline: [],
    revealLocked: false,
    myRole: null,
    isMyTurn: false,
    currentTurnUid: null,
  };
}

function createChangeResultsSnapshot() {
  return {
    room: {
      status: "RESULTS" as const,
      currentRoundId: "round-1",
      roundIndex: 1,
      settings: {
        gameMode: "change" as const,
        imageModel: "gemini" as const,
        promptModel: "flash-lite" as const,
        judgeModel: "flash-lite" as const,
        totalRounds: 1,
        aspectRatio: "1:1" as const,
        cpuCount: 0,
      },
    },
    round: {
      roundId: "round-1",
      index: 1,
      status: "RESULTS" as const,
      targetImageUrl: "https://example.com/target.png",
      targetThumbUrl: "https://example.com/target.png",
      gmTitle: "Kitchen Counter",
      gmTags: ["change"],
      reveal: {
        answerBox: {
          x: 0.4,
          y: 0.35,
          width: 0.2,
          height: 0.2,
        },
        changeSummary:
          "Edit the source image by changing exactly one small table object: replace the yellow mug with a blue glass bottle.",
      },
      endsAt: "2026-04-22T00:00:00.000Z",
      createdAt: "2026-04-22T00:00:00.000Z",
      expiresAt: "2026-04-23T00:00:00.000Z",
      startedAt: "2026-04-22T00:00:00.000Z",
      promptStartsAt: "2026-04-22T00:00:00.000Z",
      difficulty: 2 as const,
      stats: {
        submissions: 2,
        topScore: 100,
      },
      modeState: {
        kind: "change" as const,
        baseImageUrl: "https://example.com/target.png",
        changedImageUrl: "https://example.com/changed.png",
        submittedCount: 2,
        correctCount: 1,
      },
    },
    scores: [],
    players: [
      {
        uid: "host",
        displayName: "Host",
        kind: "human" as const,
        ready: false,
        isHost: true,
        totalScore: 100,
      },
      {
        uid: "guest",
        displayName: "Guest",
        kind: "human" as const,
        ready: false,
        isHost: false,
        totalScore: 0,
      },
    ],
    attempts: null,
    myAttempts: null,
    voteProgress: null,
    finalSimilarityScore: null,
    turnTimeline: [],
    revealLocked: false,
    myRole: null,
    isMyTurn: false,
    currentTurnUid: null,
    changeResults: [
      {
        uid: "host",
        displayName: "Host",
        kind: "human" as const,
        submitted: true,
        point: { x: 0.5, y: 0.4 },
        hit: true,
        score: 100,
        rank: 1,
        createdAt: "2026-04-22T00:00:01.000Z",
      },
      {
        uid: "guest",
        displayName: "Guest",
        kind: "human" as const,
        submitted: true,
        point: { x: 0.1, y: 0.1 },
        hit: false,
        score: 0,
        rank: null,
        createdAt: "2026-04-22T00:00:02.000Z",
      },
    ],
  };
}

describe("ResultsPage lobby return flow", () => {
  let snapshotState:
    | ReturnType<typeof createResultsSnapshot>
    | ReturnType<typeof createChangeResultsSnapshot>;

  beforeEach(() => {
    window.history.replaceState({}, "", "/results/ROOM1");
    snapshotState = createResultsSnapshot();
    authStateRef.current.user = {
      uid: "guest",
      issuedAt: "2026-04-22T00:00:00.000Z",
    };

    replaceMock.mockReset();
    pushMock.mockReset();
    useRoomSyncMock.mockReset();
    useRoomPresenceMock.mockReset();
    apiPostMock.mockReset();

    useRoomSyncMock.mockImplementation(() => ({
      snapshot: snapshotState,
    }));
    useRoomPresenceMock.mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("keeps showing the frozen results when the room returns to the lobby", async () => {
    const user = userEvent.setup();
    const view = render(
      <LanguageProvider initialLanguage="en">
        <ResultsPage />
      </LanguageProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByText("Ranking Results")).not.toBeNull();
    });

    snapshotState = createResultsSnapshot({
      roomStatus: "LOBBY",
      includeRound: false,
    });
    view.rerender(
      <LanguageProvider initialLanguage="en">
        <ResultsPage />
      </LanguageProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByText("Ranking Results")).not.toBeNull();
    });

    expect(screen.queryByText("Loading results...")).toBeNull();
    expect(replaceMock).not.toHaveBeenCalledWith("/lobby/ROOM1");

    await user.click(screen.getByRole("button", { name: "Back to Lobby" }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/lobby/ROOM1");
    });
  });

  it("lets the host reset the final results room and return to the lobby", async () => {
    authStateRef.current.user = {
      uid: "host",
      issuedAt: "2026-04-22T00:00:00.000Z",
    };
    apiPostMock.mockResolvedValue({
      ok: true,
      finished: true,
      nextRoundId: null,
    });

    const user = userEvent.setup();
    render(
      <LanguageProvider initialLanguage="en">
        <ResultsPage />
      </LanguageProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Back to Lobby" }));

    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalledWith("/api/rounds/next", {
        roomId: "ROOM1",
      });
      expect(pushMock).toHaveBeenCalledWith("/lobby/ROOM1");
    });
  });

  it("shows the edit prompt in Aha Moment results", async () => {
    snapshotState = createChangeResultsSnapshot();

    render(
      <LanguageProvider initialLanguage="en">
        <ResultsPage />
      </LanguageProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByText("Edit Prompt")).not.toBeNull();
    });

    expect(
      screen.queryByText(/replace the yellow mug with a blue glass bottle/i),
    ).not.toBeNull();
  });
});
