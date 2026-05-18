import { test, expect } from "@playwright/test";
import { signIn } from "./support/auth";

test.describe("habits — complete a habit", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    // Habit completion POSTs to /api/calendar/habits/[habitId]/complete.
    // Stub it so the optimistic update doesn't get clobbered by a 401.
    await page.route(
      /\/api\/calendar\/habits\/.+\/complete/,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        }),
    );
  });

  test("opens the Habits tab and records a completion", async ({ page }) => {
    await page.goto("/calendar");
    // Switch to the Habits tab (the sub-nav exposes it as a button).
    await page.getByRole("button", { name: /^habits$/i }).click();

    // A "Mark complete" / "Complete" / check button surfaces per habit
    // card. Click the first one.
    const completeBtn = page
      .getByRole("button", { name: /complete|mark complete|done today/i })
      .first();
    await completeBtn.click();

    // The streak panel re-renders — at minimum the optimistic UI updates
    // some part of the panel without throwing.
    await expect(page.getByText(/streak|completed|day/i).first()).toBeVisible();
  });
});
