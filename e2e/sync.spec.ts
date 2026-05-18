import { test, expect } from "@playwright/test";
import { signIn } from "./support/auth";

test.describe("sync — compile", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("compiling the demo graph surfaces a proposed patch", async ({ page }) => {
    await page.goto("/sync");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // The demo seed deliberately ships with conflicts so the compile
    // button has something to do — find the primary action by its
    // visible label, regardless of icon.
    const compile = page.getByRole("button", { name: /compile|propose/i }).first();
    await compile.click();

    // Once the solver finishes the patch summary, "apply" / "reset"
    // controls become available. We don't assert exact copy, only that
    // a follow-up action surfaces.
    await expect(
      page.getByRole("button", { name: /apply|accept|reset|discard/i }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
