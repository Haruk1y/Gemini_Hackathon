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
} = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  pushMock: vi.fn(),
  useRoomSyncMock: vi.fn(),
  useRoomPresenceMock: vi.fn(),
  leaveRoomMock: vi.fn(),
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

vi.mock("@/lib/client/room-sync", () => ({
  useRoomSync: (params: unknown) => useRoomSyncMock(params),
}));

vi.mock("@/lib/client/room-presence", () => ({
  useRoomPresence: (params: unknown) => useRoomPresenceMock(params),
  leaveRoom: (params: unknown) => leaveRoomMock(params),
}));

function createLobbySnapshot(playerUids: string[]) {
  return {
    room: {
      roomId: "ROOM1",
      code: "ABC123",
      status: "LOBBY" as const,
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
    players: playerUids.map((uid, index) => ({
      uid,
      displayName: index === 0 ? "Alice" : "Bob",
      kind: "human" as const,
      ready: false,
      isHost: index === 0,
      totalScore: 0,
    })),
    round: null,
    scores: [],
    attempts: null,
    playerCount: playerUids.length,
    myRole: null,
    isMyTurn: false,
    currentTurnUid: null,
    voteProgress: null,
    finalSimilarityScore: null,
    turnTimeline: [],
    revealLocked: false,
  };
}

describe("LobbyPage leave flow", () => {
  let roomSyncState: {
    snapshot: ReturnType<typeof createLobbySnapshot>;
    error: null;
    isConnecting: boolean;
  };

  beforeEach(() => {
    window.history.replaceState({}, "", "/lobby/ROOM1");
    roomSyncState = {
      snapshot: createLobbySnapshot(["anon_1", "anon_2"]),
      error: null,
      isConnecting: false,
    };

    replaceMock.mockReset();
    pushMock.mockReset();
    useRoomSyncMock.mockReset();
    useRoomPresenceMock.mockReset();
    leaveRoomMock.mockReset();

    useRoomSyncMock.mockImplementation(() => roomSyncState);
    useRoomPresenceMock.mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
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
      snapshot: createLobbySnapshot(["anon_2"]),
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
