import { test, expect } from "@playwright/test";
import { signIn } from "./support/auth";

test.describe("lattice — decompose a goal", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("decomposing a goal emits atomic subtasks", async ({ page }) => {
    await page.goto("/lattice");
    // The header reflects however many subtasks the demo emitted; this
    // stays robust to copy tweaks.
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/subtask|compiled|blocked|open/i);

    const input = page.getByPlaceholder(/high-level goal/i);
    await input.fill("Ship the Q3 launch plan");
    await page.getByRole("button", { name: /^decompose$/i }).click();

    // Lattice decomposes deterministically from the demo solver — the
    // task tree section should render at least one subtask row within a
    // reasonable budget.
    const tree = page.locator("ul").filter({ hasText: /open|complete|blocked|in_progress|user-locked|irrelevant/i });
    await expect(tree.first()).toBeVisible({ timeout: 10_000 });
  });
});
