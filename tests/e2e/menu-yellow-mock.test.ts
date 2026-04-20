import { expect, test } from "@playwright/test";

test.describe("yellow menu mockup", () => {
  test("renders the desktop party-show mockup with the full menu", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/mockups/menu-yellow");

    await expect(page.getByTestId("yellow-profile-area")).toBeVisible();
    await expect(page.getByTestId("yellow-coin-pill")).toBeVisible();
    await expect(page.getByTestId("yellow-center-banner")).toBeVisible();
    await expect(page.getByRole("button", { name: "ゲームを終了" })).toBeVisible();

    const menuLabels = [
      "レートマッチ",
      "プライベートマッチ",
      "招待コード",
      "ショップ",
      "遊び方",
      "プレイ履歴",
      "設定",
    ];

    for (const label of menuLabels) {
      await expect(page.getByRole("button", { name: label })).toBeVisible();
    }
  });

  test("renders the compressed landscape layout without the rotate overlay", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 932, height: 430 });
    await page.goto("/mockups/menu-yellow");

    await expect(page.getByTestId("yellow-profile-area")).toBeVisible();
    await expect(page.getByTestId("yellow-coin-pill")).toBeVisible();
    await expect(page.getByRole("button", { name: "レートマッチ" })).toBeVisible();
    await expect(page.getByTestId("yellow-orientation-overlay")).toBeHidden();
  });

  test("shows the rotate overlay on portrait mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/mockups/menu-yellow");

    await expect(page.getByTestId("yellow-orientation-overlay")).toBeVisible();
    await expect(page.getByRole("heading", { name: "横向きでご覧ください" })).toBeVisible();
  });
});
