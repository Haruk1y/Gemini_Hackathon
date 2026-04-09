import { describe, expect, it } from "vitest";

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

  it("resolves local UI errors in the active language", () => {
    expect(
      resolveUiErrorMessage("en", { kind: "local", key: "submitPromptFailed" }),
    ).toBe("Failed to submit the prompt.");
  });
});
