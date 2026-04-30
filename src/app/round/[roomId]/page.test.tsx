// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
          roundSeconds: 30,
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
  beforeEach(() => {
    const now = Date.now();
    roundSnapshot.room.status = "IN_ROUND";
    roundSnapshot.room.currentRoundId = "round-1";
    roundSnapshot.room.settings.gameMode = "change";
    roundSnapshot.room.settings.roundSeconds = 30;
    delete (roundSnapshot.room.settings as { aspectRatio?: unknown })
      .aspectRatio;
    roundSnapshot.round.status = "IN_ROUND";
    roundSnapshot.round.promptStartsAt = new Date(now - 31_000).toISOString();
    roundSnapshot.round.endsAt = new Date(now + 9_000).toISOString();
    roundSnapshot.round.modeState = {
      kind: "change",
      baseImageUrl: "https://example.com/base.png",
      changedImageUrl: "https://example.com/changed.png",
      submittedCount: 1,
      correctCount: 1,
    };
    (roundSnapshot as { mySubmission: unknown }).mySubmission = {
      uid: "host",
      displayName: "Host",
      kind: "human",
      point: { x: 0.5, y: 0.5 },
      hit: true,
      score: 100,
      rank: 1,
      createdAt: new Date(now - 1_000).toISOString(),
    };
    roundSnapshot.scores = [];
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
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

  it("submits the typed draft when a classic round enters the timeout grace window", async () => {
    const now = Date.now();
    roundSnapshot.room.settings.gameMode = "classic";
    roundSnapshot.room.settings.roundSeconds = 20;
    roundSnapshot.round.promptStartsAt = new Date(now - 10_000).toISOString();
    roundSnapshot.round.endsAt = new Date(now + 10_000).toISOString();
    delete (roundSnapshot.round as { modeState?: unknown }).modeState;
    (roundSnapshot as { mySubmission: unknown }).mySubmission = null;
    roundSnapshot.scores = [];
    apiPostMock.mockResolvedValue({ ok: true, status: "IN_ROUND" });

    const user = userEvent.setup();
    const view = render(
      <LanguageProvider initialLanguage="en">
        <RoundPage />
      </LanguageProvider>,
    );

    await user.type(screen.getByRole("textbox"), "partial classic draft");
    apiPostMock.mockClear();

    roundSnapshot.round.promptStartsAt = new Date(now - 21_000).toISOString();
    roundSnapshot.round.endsAt = new Date(now + 9_000).toISOString();
    view.rerender(
      <LanguageProvider initialLanguage="en">
        <RoundPage />
      </LanguageProvider>,
    );

    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalledWith("/api/rounds/endIfNeeded", {
        roomId: "ROOM1",
        roundId: "round-1",
        draftPrompt: "partial classic draft",
      });
    });
  });

  it("stages the Aha visual change with progress markers", () => {
    const now = new Date("2026-04-22T00:00:00.000Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    roundSnapshot.room.settings.roundSeconds = 30;
    roundSnapshot.round.promptStartsAt = new Date(now - 15_000).toISOString();
    roundSnapshot.round.endsAt = new Date(now + 15_000).toISOString();
    (roundSnapshot as { mySubmission: unknown }).mySubmission = null;

    const view = render(
      <LanguageProvider initialLanguage="en">
        <RoundPage />
      </LanguageProvider>,
    );

    expect(screen.getByAltText("Before").style.opacity).toBe("0.5");
    expect(screen.getByLabelText("Change starts")).not.toBeNull();
    expect(screen.getByLabelText("Change ends")).not.toBeNull();
    expect(screen.getByTestId("change-progress-fill").style.transform).toBe(
      "scaleX(0.5)",
    );
    expect(screen.getByText(/Image Changing 20s/i)).not.toBeNull();
    expect(screen.getByText(/View 1\/1/i)).not.toBeNull();

    roundSnapshot.round.promptStartsAt = new Date(now - 3_000).toISOString();
    roundSnapshot.round.endsAt = new Date(now + 27_000).toISOString();
    view.rerender(
      <LanguageProvider initialLanguage="en">
        <RoundPage />
      </LanguageProvider>,
    );
    expect(screen.getByAltText("Before").style.opacity).toBe("1");
    expect(screen.getByText(/Before Change 5s/i)).not.toBeNull();

    roundSnapshot.round.promptStartsAt = new Date(now - 27_000).toISOString();
    roundSnapshot.round.endsAt = new Date(now + 3_000).toISOString();
    view.rerender(
      <LanguageProvider initialLanguage="en">
        <RoundPage />
      </LanguageProvider>,
    );
    expect(screen.getByAltText("Before").style.opacity).toBe("0");
    expect(screen.getByText(/After Change 5s/i)).not.toBeNull();

    roundSnapshot.room.settings.roundSeconds = 65;
    roundSnapshot.round.promptStartsAt = new Date(now - 50_000).toISOString();
    roundSnapshot.round.endsAt = new Date(now + 15_000).toISOString();
    view.rerender(
      <LanguageProvider initialLanguage="en">
        <RoundPage />
      </LanguageProvider>,
    );
    expect(screen.getByAltText("Before").style.opacity).toBe("0.5");
    expect(screen.getByTestId("change-progress-fill").style.transform).toBe(
      "scaleX(0.5)",
    );
    expect(screen.getByText(/View 2\/2/i)).not.toBeNull();
    expect(screen.getByText(/View 2\/2\s+\/ 50%/i)).not.toBeNull();
    expect(screen.getAllByLabelText("Change starts")).toHaveLength(1);
    expect(screen.getAllByLabelText("Change ends")).toHaveLength(1);

    roundSnapshot.round.promptStartsAt = new Date(now - 32_000).toISOString();
    roundSnapshot.round.endsAt = new Date(now + 33_000).toISOString();
    view.rerender(
      <LanguageProvider initialLanguage="en">
        <RoundPage />
      </LanguageProvider>,
    );
    expect(screen.getByTestId("change-reset-canvas")).not.toBeNull();
    expect(screen.getByTestId("change-progress-fill").style.transform).toBe(
      "scaleX(0)",
    );
    expect(screen.getByText(/View 2\/2\s+\/ 0%/i)).not.toBeNull();
  });

  it("shows missed Aha clicks as 0 points in the in-round scoreboard", () => {
    const now = Date.now();
    roundSnapshot.room.settings.roundSeconds = 30;
    roundSnapshot.round.promptStartsAt = new Date(now - 15_000).toISOString();
    roundSnapshot.round.endsAt = new Date(now + 15_000).toISOString();
    (roundSnapshot as { mySubmission: unknown }).mySubmission = null;
    (roundSnapshot as {
      scores: Array<{
        uid: string;
        displayName: string;
        bestScore: number;
        bestImageUrl: string;
      }>;
    }).scores = [
      {
        uid: "guest",
        displayName: "Guest",
        bestScore: 0,
        bestImageUrl: "",
      },
    ];

    render(
      <LanguageProvider initialLanguage="en">
        <RoundPage />
      </LanguageProvider>,
    );

    expect(screen.getByText("1. Guest")).not.toBeNull();
    expect(screen.getByText("0")).not.toBeNull();
  });

  it("keeps the Aha image click target visually still on hover", () => {
    const now = Date.now();
    roundSnapshot.round.promptStartsAt = new Date(now - 15_000).toISOString();
    roundSnapshot.round.endsAt = new Date(now + 15_000).toISOString();
    (roundSnapshot as { mySubmission: unknown }).mySubmission = null;

    render(
      <LanguageProvider initialLanguage="en">
        <RoundPage />
      </LanguageProvider>,
    );

    const imageButton = screen.getByAltText("Before").closest("button");
    expect(imageButton?.className).not.toContain("hover:translate");
    expect(imageButton?.className).not.toContain("transition-transform");
  });

  it("places the local Aha click marker in the displayed image area when the frame is letterboxed", async () => {
    const now = Date.now();
    roundSnapshot.room.settings.roundSeconds = 30;
    (roundSnapshot.room.settings as { aspectRatio?: "1:1" }).aspectRatio =
      "1:1";
    roundSnapshot.round.promptStartsAt = new Date(now - 15_000).toISOString();
    roundSnapshot.round.endsAt = new Date(now + 15_000).toISOString();
    (roundSnapshot as { mySubmission: unknown }).mySubmission = null;
    apiPostMock.mockResolvedValue({
      ok: true,
      hit: false,
      score: 0,
      rank: null,
      submittedCount: 1,
      correctCount: 0,
    });

    render(
      <LanguageProvider initialLanguage="en">
        <RoundPage />
      </LanguageProvider>,
    );

    const imageButton = screen.getByAltText("Before").closest("button");
    const imageStage = screen.getByAltText("Before").parentElement;
    if (!imageButton || !imageStage) {
      throw new Error("Aha image stage was not rendered.");
    }

    imageStage.getBoundingClientRect = () =>
      ({
        left: 100,
        top: 50,
        right: 260,
        bottom: 140,
        width: 160,
        height: 90,
        x: 100,
        y: 50,
        toJSON: () => ({}),
      }) as DOMRect;

    fireEvent.click(imageButton, {
      clientX: 135,
      clientY: 95,
    });

    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalledWith("/api/rounds/click", {
        roomId: "ROOM1",
        roundId: "round-1",
        x: 0,
        y: 0.5,
      });
    });

    const marker = await screen.findByTestId("change-click-marker");
    expect(marker.style.left).toBe("21.875%");
    expect(marker.style.top).toBe("50%");
  });
});
