import { expect, test } from "@playwright/test";

const liveE2EEnabled = process.env.RUN_LIVE_E2E === "true";
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

function buildLiveUrl(pathname = "/"): string {
  const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:3000";
  const url = new URL(pathname, baseUrl);

  if (bypassSecret && url.hostname.endsWith(".vercel.app")) {
    url.searchParams.set("x-vercel-protection-bypass", bypassSecret);
    url.searchParams.set("x-vercel-set-bypass-cookie", "true");
  }

  return url.toString();
}

test.describe("live generation progress", () => {
  test.skip(!liveE2EEnabled, "live smoke test is opt-in");

  test("shows generating, then image, then scoring on a deployment URL", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const japanesePrompt = "赤いりんごを持ったねこ";

    await page.goto(buildLiveUrl("/"));

    await page.locator("input").first().fill("Smoke Host");
    await page.getByRole("button", { name: "Create Room" }).click();

    await expect(page).toHaveURL(/\/lobby\//, { timeout: 20_000 });

    await page.getByRole("button", { name: "WAIT" }).click();
    await expect(page.getByRole("button", { name: "READY" })).toBeVisible();

    await page.getByRole("button", { name: "Start Round" }).click();
    await expect(page).toHaveURL(/\/round\//, { timeout: 120_000 });

    await page.locator("textarea").fill(japanesePrompt);
    await page.getByRole("button", { name: "Generate image" }).click();

    await expect(page.getByText("Generating image...").first()).toBeVisible();
    await expect(page.locator('img[src*="placehold.co"]')).toHaveCount(0);

    const generatedImage = page.getByAltText("latest attempt");
    await expect(generatedImage).toBeVisible({ timeout: 120_000 });

    await expect(page.getByText("Scoring...").first()).toBeVisible({
      timeout: 30_000,
    });

    await expect(page.getByText(/\d+ pts/).first()).toBeVisible({
      timeout: 60_000,
    });
  });
});
