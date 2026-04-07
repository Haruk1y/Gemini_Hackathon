import { test } from "@playwright/test";

test.describe("multiplayer flow", () => {
  test.skip("2 players can complete 3 rounds", async () => {
    // Requires Google Cloud credentials, Vertex AI access, and a seeded environment.
    // Intentionally skipped in CI by default.
  });
});
