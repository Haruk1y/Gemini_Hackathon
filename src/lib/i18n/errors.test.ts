import { describe, expect, it } from "vitest";

import {
  GEMINI_INVALID_API_KEY_MESSAGE,
  GEMINI_QUOTA_EXHAUSTED_MESSAGE,
} from "@/lib/gemini/error-messages";
import { resolveApiErrorMessage, resolveUiErrorMessage } from "@/lib/i18n/errors";

describe("i18n error resolution", () => {
  it("uses specific API message translations when a known backend message is present", () => {
    expect(
      resolveApiErrorMessage("en", "ROOM_NOT_JOINABLE", "Room is already full"),
    ).toBe("This room is already full.");
  });

  it("falls back to a generic code translation when the raw message is unknown", () => {
    expect(
      resolveApiErrorMessage("ja", "INTERNAL_ERROR", "Unexpected server error"),
    ).toBe("サーバーエラーが発生しました。しばらくしてから再試行してください。");
  });

  it("localizes known Gemini backend messages", () => {
    expect(
      resolveApiErrorMessage("ja", "GEMINI_ERROR", GEMINI_INVALID_API_KEY_MESSAGE),
    ).toBe(
      "画像生成 API キーが無効か権限不足です。サーバー側で GEMINI_API_KEY を確認してください。",
    );
    expect(
      resolveApiErrorMessage("en", "GEMINI_ERROR", GEMINI_QUOTA_EXHAUSTED_MESSAGE),
    ).toBe(
      "Image generation quota is exhausted. Please wait a moment or check Gemini quota and billing.",
    );
  });

  it("resolves local UI errors in the active language", () => {
    expect(
      resolveUiErrorMessage("en", { kind: "local", key: "submitPromptFailed" }),
    ).toBe("Failed to submit the prompt.");
  });
});
