import { test, expect } from "@playwright/test";
import { signIn } from "./support/auth";

test.describe("create project", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    // Intercept the Firestore REST endpoints so the modal's "Create"
    // doesn't hang. The wizard reads success purely from a resolved
    // promise — the response body doesn't have to be schema-perfect.
    await page.route("**/firestore.googleapis.com/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ name: "projects/e2e-stub/databases/(default)/documents/projects/e2e-fake" }),
      }),
    );
  });

  test("opens the new-project wizard and walks both steps", async ({ page }) => {
    await page.goto("/research");
    // Trigger from whatever entry point the layout exposes.
    const trigger = page.getByRole("button", { name: /new project/i }).first();
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: /create project/i });
    await expect(dialog).toBeVisible();

    await dialog.getByPlaceholder(/e\.g\. sleep/i).fill("E2E Project");
    await dialog.getByRole("button", { name: /reasoning/i }).first().click();
    await dialog.getByRole("button", { name: /next step/i }).click();

    // Step 2 — system instructions + create button.
    await dialog.getByPlaceholder(/guide how forge/i).fill("Stick to peer-reviewed sources.");
    await expect(dialog.getByRole("button", { name: /create project/i })).toBeEnabled();
  });

  test("Escape closes the modal and returns focus to the trigger", async ({ page }) => {
    await page.goto("/research");
    const trigger = page.getByRole("button", { name: /new project/i }).first();
    await trigger.click();
    await expect(page.getByRole("dialog", { name: /create project/i })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: /create project/i })).toBeHidden();
  });
});
