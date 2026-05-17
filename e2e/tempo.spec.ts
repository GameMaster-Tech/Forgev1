import { test, expect } from "@playwright/test";
import { signIn } from "./support/auth";

test.describe("tempo — focus blocks", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("Tempo tab surfaces focus blocks Tempo placed", async ({ page }) => {
    await page.goto("/calendar");
    await page.getByRole("button", { name: /^tempo$/i }).click();

    await expect(page.getByText(/priority queue/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/overload heatmap/i)).toBeVisible();
    await expect(page.getByText(/focus blocks tempo placed/i)).toBeVisible();
  });
});
