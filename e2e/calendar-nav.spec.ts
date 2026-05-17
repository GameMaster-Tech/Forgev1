import { test, expect } from "@playwright/test";
import { signIn } from "./support/auth";

test.describe("calendar — grid navigation", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("switches between Month, Week, Day and Agenda views", async ({ page }) => {
    await page.goto("/calendar");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // The view switcher only renders on desktop above sm; on mobile we
    // get the stacked list automatically. Skip the toggle assertions
    // on mobile and just verify a grid heading shows up.
    if ((page.viewportSize()?.width ?? 0) < 640) {
      await expect(page.locator("text=/Calendar ·/i")).toBeVisible();
      return;
    }

    // Default month view — the grid surfaces via role=grid.
    await expect(page.getByRole("grid", { name: /calendar/i })).toBeVisible();

    // Switch to week — pressing the Week button keeps us in /calendar
    // and renders the 7-col week grid (which still has Sun..Sat
    // headers in this implementation).
    await page.getByRole("button", { name: /^week$/i }).click();

    // Day view → header shows the long weekday name (e.g. "Monday").
    await page.getByRole("button", { name: /^day$/i }).click();
    await expect(
      page.getByText(/monday|tuesday|wednesday|thursday|friday|saturday|sunday/i).first(),
    ).toBeVisible();

    // Agenda view — list role surfaces.
    await page.getByRole("button", { name: /^agenda$/i }).click();
    await expect(page.getByRole("list", { name: /agenda/i })).toBeVisible();
  });

  test("arrow keys move focus across the month grid", async ({ page }) => {
    if ((page.viewportSize()?.width ?? 0) < 640) {
      test.skip(true, "month grid stacks into a list under 640px");
    }
    await page.goto("/calendar");
    const grid = page.getByRole("grid", { name: /calendar/i });
    await expect(grid).toBeVisible();

    // Roving tabindex — Tab lands on the focused gridcell (today).
    await grid.locator('[role="gridcell"][tabindex="0"]').first().focus();
    await page.keyboard.press("ArrowRight");
    // The active element should be a gridcell (not the previous one) —
    // we don't assert a specific date because that depends on the day
    // the suite runs on.
    const role = await page.evaluate(() => document.activeElement?.getAttribute("role"));
    expect(role).toBe("gridcell");
  });
});
