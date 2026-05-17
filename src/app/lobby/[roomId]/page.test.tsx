// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import LobbyPage from "@/app/lobby/[roomId]/page";
import { LanguageProvider } from "@/components/providers/language-provider";

const {
  replaceMock,
  pushMock,
  useRoomSyncMock,
  useRoomPresenceMock,
  leaveRoomMock,
  apiPostMock,
} = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  pushMock: vi.fn(),
  useRoomSyncMock: vi.fn(),
  useRoomPresenceMock: vi.fn(),
  leaveRoomMock: vi.fn(),
  apiPostMock: vi.fn(),
}));

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
      uid: "anon_1",
      issuedAt: "2026-04-22T00:00:00.000Z",
    },
    loading: false,
    error: null,
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

vi.mock("@/lib/client/room-sync", () => ({
  useRoomSync: (params: unknown) => useRoomSyncMock(params),
}));

vi.mock("@/lib/client/room-presence", () => ({
  useRoomPresence: (params: unknown) => useRoomPresenceMock(params),
  leaveRoom: (params: unknown) => leaveRoomMock(params),
}));

function createLobbySnapshot(params?: {
  meReady?: boolean;
  otherReady?: boolean;
  gameMode?: "classic" | "memory" | "change" | "impostor";
  imageModel?: "gemini" | "flux";
  includeGuest?: boolean;
  roundSeconds?: number;
  roomStatus?:
    | "LOBBY"
    | "IN_ROUND"
    | "RESULTS"
    | "GENERATING_ROUND"
    | "FINISHED";
}) {
  const gameMode = params?.gameMode ?? "classic";
  const imageModel = params?.imageModel ?? "gemini";
  const players = [
    {
      uid: "anon_1",
      displayName: "Alice",
      kind: "human" as const,
      ready: params?.meReady ?? false,
      isHost: true,
      totalScore: 0,
    },
    ...(params?.includeGuest === false
      ? []
      : [
          {
            uid: "anon_2",
            displayName: "Bob",
            kind: "human" as const,
            ready: params?.otherReady ?? false,
            isHost: false,
            totalScore: 0,
          },
        ]),
  ];

  return {
    room: {
      roomId: "ROOM1",
      code: "ABC123",
      status: params?.roomStatus ?? "LOBBY",
      currentRoundId: null,
      settings: {
        gameMode,
        maxPlayers: 8,
        roundSeconds: params?.roundSeconds ?? 60,
        maxAttempts: 3,
        hintLimit: 0,
        imageModel,
        promptModel: "flash-lite" as const,
        judgeModel: "flash-lite" as const,
        totalRounds: 1,
        cpuCount: 0,
      },
    },
    players,
    round: null,
    scores: [],
    attempts: null,
    playerCount: players.length,
    myRole: null,
    isMyTurn: false,
    currentTurnUid: null,
    voteProgress: null,
    finalSimilarityScore: null,
    turnTimeline: [],
    revealLocked: false,
  };
}

describe("LobbyPage", () => {
  let roomSyncState: {
    snapshot: ReturnType<typeof createLobbySnapshot>;
    error: null;
    isConnecting: boolean;
  };

  beforeEach(() => {
    window.history.replaceState({}, "", "/lobby/ROOM1");
    roomSyncState = {
      snapshot: createLobbySnapshot({ meReady: true }),
      error: null,
      isConnecting: false,
    };

    replaceMock.mockReset();
    pushMock.mockReset();
    useRoomSyncMock.mockReset();
    useRoomPresenceMock.mockReset();
    leaveRoomMock.mockReset();
    apiPostMock.mockReset();

    useRoomSyncMock.mockImplementation(() => roomSyncState);
    useRoomPresenceMock.mockImplementation(() => undefined);
    apiPostMock.mockResolvedValue({ ok: true, updated: true, ready: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("auto-readies the player once when they enter the lobby while waiting", async () => {
    roomSyncState = {
      ...roomSyncState,
      snapshot: createLobbySnapshot({ meReady: false }),
    };

    render(
      <LanguageProvider initialLanguage="en">
        <LobbyPage />
      </LanguageProvider>,
    );

    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalledWith("/api/rooms/ready", {
        roomId: "ROOM1",
        ready: true,
      });
    });
  });

  it("shows a compact players list without the lobby language toggle", () => {
    render(
      <LanguageProvider initialLanguage="en">
        <LobbyPage />
      </LanguageProvider>,
    );

    expect(screen.queryByRole("button", { name: "READY" })).toBeNull();
    expect(
      screen.queryByRole("group", { name: "Display language" }),
    ).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Copy room code" })
        .parentElement?.querySelector(
          '[role="group"][aria-label="Display language"]',
        ),
    ).toBeNull();
    expect(screen.queryByText("2 PLAYERS")).toBeNull();
    expect(screen.queryByText("READY")).toBeNull();
    expect(screen.queryByText("YOU")).toBeNull();
    expect(screen.queryByText("HOST")).toBeNull();
    expect(
      screen.getByText("Alice").parentElement?.parentElement?.className,
    ).toContain("bg-[var(--pmb-yellow)]");
    expect(apiPostMock).not.toHaveBeenCalledWith("/api/rooms/ready", {
      roomId: "ROOM1",
      ready: false,
    });
  });

  it("shows all game modes without scroll controls", () => {
    render(
      <LanguageProvider initialLanguage="en">
        <LobbyPage />
      </LanguageProvider>,
    );

    expect(screen.getByRole("button", { name: "Classic" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Memory Match" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Aha Moment" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Art Impostor" })).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "Scroll game modes down" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Scroll game modes up" }),
    ).toBeNull();
  });

  it("updates the mode detail panel after selecting a game mode", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <LanguageProvider initialLanguage="en">
        <LobbyPage />
      </LanguageProvider>,
    );

    expect(
      screen.queryByText(
        "The standard mode where you create prompts while looking at the target image.",
      ),
    ).toBeNull();
    expect(screen.getByText("Estimate Target Image Prompt")).not.toBeNull();
    expect(screen.getByText("STEP 1/4")).not.toBeNull();
    expect(screen.getByText("Target Image")).not.toBeNull();
    expect(screen.getByText("Generated Image")).not.toBeNull();
    expect(screen.getByText("Ranking")).not.toBeNull();
    expect(screen.queryByText("Best")).toBeNull();
    expect(screen.getByText("Prompt")).not.toBeNull();
    expect(screen.queryByText("Prompt Text")).toBeNull();
    expect(
      container.querySelector('img[src*="classic-generated"]'),
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: "Next demo step" }));
    await waitFor(() => {
      expect(screen.getByText("Writing Prompt")).not.toBeNull();
    });

    await user.click(
      screen.getByRole("button", { name: "Previous demo step" }),
    );
    await waitFor(() => {
      expect(screen.getByText("Estimate Target Image Prompt")).not.toBeNull();
    });

    await user.click(screen.getByRole("button", { name: /Memory Match/i }));

    await waitFor(() => {
      expect(screen.getByText("Memorize Target Image")).not.toBeNull();
    });
    expect(
      container.querySelector('img[src*="memory-generated"]'),
    ).toBeNull();
    expect(screen.getAllByText("Memory Match").length).toBeGreaterThan(0);
    expect(screen.getByText("STEP 1/4")).not.toBeNull();
    expect(screen.getAllByText("Prompt").length).toBeGreaterThan(0);
    expect(screen.getByText("Ranking")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: /Aha Moment/i }));

    await waitFor(() => {
      expect(screen.getByText("Observe Original Image")).not.toBeNull();
    });
    expect(screen.queryByText("Action Stage")).toBeNull();
    expect(screen.queryByText("Prompt Text")).toBeNull();
    expect(screen.getByText("Ranking")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: /Art Impostor/i }));

    await waitFor(() => {
      expect(screen.getByText("Shown Your Role")).not.toBeNull();
    });
    expect(screen.getByText("STEP 1/5")).not.toBeNull();
    expect(screen.queryByText("Relay Image")).toBeNull();
    expect(screen.queryByText("Generation")).toBeNull();
    expect(screen.getAllByText("YOU ARE").length).toBeGreaterThan(1);
    expect(screen.getAllByText("IMPOSTER").length).toBeGreaterThan(0);
    expect(screen.queryByText("Vote Phase")).toBeNull();
  });

  it("registers the mode demo auto-advance without saving room settings", async () => {
    const intervalSpy = vi
      .spyOn(window, "setInterval")
      .mockImplementation(
        () => 1 as unknown as ReturnType<typeof window.setInterval>,
      );

    try {
      render(
        <LanguageProvider initialLanguage="en">
          <LobbyPage />
        </LanguageProvider>,
      );

      apiPostMock.mockClear();

      await waitFor(() => {
        expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 3400);
      });
      expect(apiPostMock).not.toHaveBeenCalledWith(
        "/api/rooms/settings",
        expect.anything(),
      );
    } finally {
      intervalSpy.mockRestore();
    }
  });

  it("auto-readies again when the lobby page is visited again later", async () => {
    roomSyncState = {
      ...roomSyncState,
      snapshot: createLobbySnapshot({ meReady: false }),
    };

    const firstView = render(
      <LanguageProvider initialLanguage="en">
        <LobbyPage />
      </LanguageProvider>,
    );

    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalledWith("/api/rooms/ready", {
        roomId: "ROOM1",
        ready: true,
      });
    });

    firstView.unmount();
    apiPostMock.mockClear();

    roomSyncState = {
      ...roomSyncState,
      snapshot: createLobbySnapshot({ meReady: false }),
    };

    render(
      <LanguageProvider initialLanguage="en">
        <LobbyPage />
      </LanguageProvider>,
    );

    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalledWith("/api/rooms/ready", {
        roomId: "ROOM1",
        ready: true,
      });
    });
  });

  it("keeps showing the loading state instead of the roomSessionMismatch flash while leaving", async () => {
    let resolveLeave: (() => void) | undefined;
    const leavePromise = new Promise<void>((resolve) => {
      resolveLeave = () => resolve();
    });
    leaveRoomMock.mockReturnValue(leavePromise);

    const user = userEvent.setup();
    const view = render(
      <LanguageProvider initialLanguage="en">
        <LobbyPage />
      </LanguageProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Leave" }));

    await waitFor(() => {
      expect(useRoomSyncMock).toHaveBeenLastCalledWith({
        roomId: "ROOM1",
        view: "lobby",
        enabled: false,
      });
    });

    await waitFor(() => {
      expect(useRoomPresenceMock).toHaveBeenLastCalledWith({
        roomId: "ROOM1",
        enabled: false,
      });
    });

    roomSyncState = {
      ...roomSyncState,
      snapshot: {
        ...createLobbySnapshot({ meReady: true }),
        players: [createLobbySnapshot({ meReady: true }).players[1]!],
        playerCount: 1,
      },
    };
    view.rerender(
      <LanguageProvider initialLanguage="en">
        <LobbyPage />
      </LanguageProvider>,
    );

    expect(screen.queryByText("Loading...")).not.toBeNull();
    expect(
      screen.queryByText(
        "The session did not match the room membership. Please reload the page.",
      ),
    ).toBeNull();

    resolveLeave?.();

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/");
    });
  });

  it("navigates back to the menu after a successful leave", async () => {
    leaveRoomMock.mockResolvedValue(undefined);

    const user = userEvent.setup();
    render(
      <LanguageProvider initialLanguage="en">
        <LobbyPage />
      </LanguageProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Leave" }));

    await waitFor(() => {
      expect(leaveRoomMock).toHaveBeenCalledWith({ roomId: "ROOM1" });
      expect(replaceMock).toHaveBeenCalledWith("/");
    });
  });

  it("restores the lobby UI and shows an error when leaving fails", async () => {
    leaveRoomMock.mockRejectedValue(new Error("leave failed"));

    const user = userEvent.setup();
    render(
      <LanguageProvider initialLanguage="en">
        <LobbyPage />
      </LanguageProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Leave" }));

    await waitFor(() => {
      expect(screen.queryByText("Failed to leave the room.")).not.toBeNull();
    });

    expect(replaceMock).not.toHaveBeenCalled();
    expect(
      screen.queryByText(
        "The session did not match the room membership. Please reload the page.",
      ),
    ).toBeNull();
  });

  it("enables Start Round for a solo host in Aha Moment", async () => {
    roomSyncState = {
      ...roomSyncState,
      snapshot: createLobbySnapshot({
        meReady: true,
        gameMode: "change",
        includeGuest: false,
        roundSeconds: 30,
      }),
    };

    render(
      <LanguageProvider initialLanguage="en">
        <LobbyPage />
      </LanguageProvider>,
    );

    await waitFor(() => {
      const startButton = screen.getByRole("button", { name: "Start Round" });
      expect((startButton as HTMLButtonElement).disabled).toBe(false);
    });
  });

  it("allows selecting Aha Moment while the room uses Flux", async () => {
    roomSyncState = {
      ...roomSyncState,
      snapshot: createLobbySnapshot({
        meReady: true,
        imageModel: "flux",
      }),
    };

    const user = userEvent.setup();
    render(
      <LanguageProvider initialLanguage="en">
        <LobbyPage />
      </LanguageProvider>,
    );

    const ahaButton = screen.getByRole("button", { name: /Aha Moment/i });
    expect((ahaButton as HTMLButtonElement).disabled).toBe(false);

    await user.click(ahaButton);

    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalledWith("/api/rooms/settings", {
        roomId: "ROOM1",
        settings: expect.objectContaining({
          gameMode: "change",
          roundSeconds: 30,
        }),
      });
    });
  });

  it("defaults classic and memory back to 60 seconds after leaving Aha Moment", async () => {
    roomSyncState = {
      ...roomSyncState,
      snapshot: createLobbySnapshot({
        meReady: true,
        gameMode: "change",
        includeGuest: false,
        roundSeconds: 30,
      }),
    };

    const user = userEvent.setup();
    const view = render(
      <LanguageProvider initialLanguage="en">
        <LobbyPage />
      </LanguageProvider>,
    );

    await user.click(screen.getByRole("button", { name: /Memory Match/i }));

    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalledWith("/api/rooms/settings", {
        roomId: "ROOM1",
        settings: expect.objectContaining({
          gameMode: "memory",
          roundSeconds: 60,
        }),
      });
    });

    view.unmount();
    apiPostMock.mockClear();

    roomSyncState = {
      ...roomSyncState,
      snapshot: createLobbySnapshot({
        meReady: true,
        gameMode: "change",
        includeGuest: false,
        roundSeconds: 30,
      }),
    };

    render(
      <LanguageProvider initialLanguage="en">
        <LobbyPage />
      </LanguageProvider>,
    );

    await user.click(screen.getByRole("button", { name: /Classic/i }));

    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalledWith("/api/rooms/settings", {
        roomId: "ROOM1",
        settings: expect.objectContaining({
          gameMode: "classic",
          roundSeconds: 60,
        }),
      });
    });
  });

  it("uses the Aha time picker as a repeat count and saves two views with a reset gap", async () => {
    roomSyncState = {
      ...roomSyncState,
      snapshot: createLobbySnapshot({
        meReady: true,
        gameMode: "change",
        includeGuest: false,
        roundSeconds: 30,
      }),
    };

    const user = userEvent.setup();
    render(
      <LanguageProvider initialLanguage="en">
        <LobbyPage />
      </LanguageProvider>,
    );

    const repeatPicker = screen.getByRole("spinbutton", {
      name: "Change Views",
    });
    expect(repeatPicker.getAttribute("aria-valuetext")).toBe("1 VIEW");

    repeatPicker.focus();
    await user.keyboard("{ArrowDown}");

    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalledWith("/api/rooms/settings", {
        roomId: "ROOM1",
        settings: expect.objectContaining({
          gameMode: "change",
          roundSeconds: 65,
        }),
      });
    });
  });

  it("allows classic mode to save expanded round and time limits", async () => {
    roomSyncState = {
      ...roomSyncState,
      snapshot: createLobbySnapshot({
        meReady: true,
        includeGuest: false,
      }),
    };

    const user = userEvent.setup();
    render(
      <LanguageProvider initialLanguage="en">
        <LobbyPage />
      </LanguageProvider>,
    );

    const roundsPicker = screen.getByRole("spinbutton", {
      name: "Change Rounds",
    });
    expect(roundsPicker.getAttribute("aria-valuemax")).toBe("5");

    roundsPicker.focus();
    await user.keyboard("{End}");

    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalledWith("/api/rooms/settings", {
        roomId: "ROOM1",
        settings: expect.objectContaining({
          gameMode: "classic",
          totalRounds: 5,
        }),
      });
    });

    const timePicker = screen.getByRole("spinbutton", {
      name: "Change Time",
    });
    expect(timePicker.getAttribute("aria-valuemax")).toBe("120");

    timePicker.focus();
    await user.keyboard("{ArrowDown}");

    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalledWith("/api/rooms/settings", {
        roomId: "ROOM1",
        settings: expect.objectContaining({
          gameMode: "classic",
          roundSeconds: 75,
        }),
      });
    });

    await user.keyboard("{End}");

    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalledWith("/api/rooms/settings", {
        roomId: "ROOM1",
        settings: expect.objectContaining({
          gameMode: "classic",
          roundSeconds: 120,
        }),
      });
    });
  });

  it("allows classic mode to save up to five CPU players", async () => {
    roomSyncState = {
      ...roomSyncState,
      snapshot: createLobbySnapshot({
        meReady: true,
        includeGuest: false,
      }),
    };

    const user = userEvent.setup();
    render(
      <LanguageProvider initialLanguage="en">
        <LobbyPage />
      </LanguageProvider>,
    );

    const cpuPicker = screen.getByRole("spinbutton", {
      name: "Change CPU",
    });
    expect(cpuPicker.getAttribute("aria-valuemax")).toBe("5");

    cpuPicker.focus();
    await user.keyboard("{End}");

    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalledWith("/api/rooms/settings", {
        roomId: "ROOM1",
        settings: expect.objectContaining({
          gameMode: "classic",
          cpuCount: 5,
        }),
      });
    });
  });
});
