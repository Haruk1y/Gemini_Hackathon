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
    apiPost: (path: string, body: Record<string, unknown>) => apiPostMock(path, body),
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
  roomStatus?: "LOBBY" | "IN_ROUND" | "RESULTS" | "GENERATING_ROUND" | "FINISHED";
}) {
  return {
    room: {
      roomId: "ROOM1",
      code: "ABC123",
      status: params?.roomStatus ?? "LOBBY",
      currentRoundId: null,
      settings: {
        gameMode: "classic" as const,
        maxPlayers: 8,
        roundSeconds: 60,
        maxAttempts: 3,
        hintLimit: 0,
        imageModel: "gemini" as const,
        promptModel: "flash-lite" as const,
        judgeModel: "flash-lite" as const,
        totalRounds: 1,
        cpuCount: 0,
      },
    },
    players: [
      {
        uid: "anon_1",
        displayName: "Alice",
        kind: "human" as const,
        ready: params?.meReady ?? false,
        isHost: true,
        totalScore: 0,
      },
      {
        uid: "anon_2",
        displayName: "Bob",
        kind: "human" as const,
        ready: params?.otherReady ?? false,
        isHost: false,
        totalScore: 0,
      },
    ],
    round: null,
    scores: [],
    attempts: null,
    playerCount: 2,
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

  it("does not auto-ready again after the player manually switches back to WAIT", async () => {
    roomSyncState = {
      ...roomSyncState,
      snapshot: createLobbySnapshot({ meReady: false }),
    };

    const user = userEvent.setup();
    const view = render(
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

    roomSyncState = {
      ...roomSyncState,
      snapshot: createLobbySnapshot({ meReady: true }),
    };
    view.rerender(
      <LanguageProvider initialLanguage="en">
        <LobbyPage />
      </LanguageProvider>,
    );

    await user.click(screen.getByRole("button", { name: "READY" }));

    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalledWith("/api/rooms/ready", {
        roomId: "ROOM1",
        ready: false,
      });
    });

    roomSyncState = {
      ...roomSyncState,
      snapshot: createLobbySnapshot({ meReady: false }),
    };
    view.rerender(
      <LanguageProvider initialLanguage="en">
        <LobbyPage />
      </LanguageProvider>,
    );

    await waitFor(() => {
      const autoReadyCalls = apiPostMock.mock.calls.filter(
        ([path, body]) =>
          path === "/api/rooms/ready" &&
          (body as { ready?: boolean }).ready === true,
      );
      expect(autoReadyCalls).toHaveLength(1);
    });
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
    let resolveLeave: (() => void) | null = null;
    const leavePromise = new Promise<void>((resolve) => {
      resolveLeave = resolve;
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
});
