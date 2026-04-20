// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import HomePageClient from "@/components/home/home-page-client";
import { LanguageProvider } from "@/components/providers/language-provider";

const { pushMock, apiPostMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  apiPostMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock("@/lib/client/api", () => ({
  apiPost: apiPostMock,
}));

vi.mock("@/components/providers/auth-provider", () => ({
  useAuth: () => ({
    user: {
      id: "anon-user",
      token: "anon-token",
    },
    loading: false,
    error: null,
  }),
}));

describe("HomePageClient", () => {
  beforeEach(() => {
    apiPostMock.mockReset();
    pushMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("includes image, prompt, and judge model settings in the create room payload", async () => {
    apiPostMock.mockResolvedValue({
      ok: true,
      roomId: "ROOM123",
    });

    const user = userEvent.setup();

    render(
      <LanguageProvider initialLanguage="en">
        <HomePageClient
          initialImageModel="gemini"
          initialPromptModel="flash"
          initialJudgeModel="flash"
        />
      </LanguageProvider>,
    );

    const createNameInput = screen.getAllByPlaceholderText(
      "Display name (at least 1 character)",
    )[0];
    await user.type(createNameInput, "Haruki");

    const imageModelSection = screen.getByText("Image Model").closest("div");
    const promptModelSection = screen.getByText("Prompt Model").closest("div");
    const judgeModelSection = screen.getByText("Judge Model").closest("div");

    expect(imageModelSection).not.toBeNull();
    expect(promptModelSection).not.toBeNull();
    expect(judgeModelSection).not.toBeNull();

    await user.click(
      within(imageModelSection as HTMLElement).getByRole("button", {
        name: "Flux",
      }),
    );
    await user.click(
      within(promptModelSection as HTMLElement).getByRole("button", {
        name: "Flash-Lite",
      }),
    );
    await user.click(
      within(judgeModelSection as HTMLElement).getByRole("button", {
        name: "Flash-Lite",
      }),
    );

    await user.click(
      screen.getByRole("button", {
        name: "Create Room",
      }),
    );

    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalledWith("/api/rooms/create", {
        displayName: "Haruki",
        settings: {
          imageModel: "flux",
          promptModel: "flash-lite",
          judgeModel: "flash-lite",
        },
      });
    });

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/lobby/ROOM123");
    });
  });
});
