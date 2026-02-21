import { test } from "@playwright/test";

test.describe("multiplayer flow", () => {
  test.skip("2 players can complete 3 rounds", async () => {
    // Requires Firebase + Gemini credentials and seeded environment.
    // Intentionally skipped in CI by default.
  });
});
