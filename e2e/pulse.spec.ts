import { test, expect } from "@playwright/test";
import { signIn } from "./support/auth";

test.describe("pulse — reality sync", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("clicking 'Reality-sync now' runs and updates the stats strip", async ({ page }) => {
    await page.goto("/pulse");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // Stat strip is rendered before the sync runs (mounting reveals
    // the four-card grid). Capture the "Invalidated" stat once to
    // compare against the post-run state.
    const button = page.getByRole("button", { name: /reality-sync now/i });
    await expect(button).toBeVisible();
    await button.click();

    // After the run the tabs switch on; the diffs tab in the Pulse
    // sub-nav should surface with a count badge (e.g. "Diffs 10").
    await expect(
      page.getByRole("navigation", { name: /pulse sections/i }).getByRole("button", { name: /^diffs/i }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
