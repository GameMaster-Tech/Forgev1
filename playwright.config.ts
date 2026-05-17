import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config.
 *
 * Boots the Next dev server via `webServer` so `npm run test:e2e`
 * is one command. Two projects (desktop + iPhone SE) so we exercise
 * both the floating sidebar layout and the mobile bottom-bar layout
 * from the same suite.
 *
 * Set `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true` and run
 * `firebase emulators:start --only auth,firestore` before invoking
 * the suite when you want the auth + Firestore tests to hit real
 * emulators. When the env var is unset, the support harness in
 * `e2e/support/auth.ts` falls through to a route-stub mode that
 * mocks Firebase responses inside the page — no emulator needed —
 * which keeps the suite green in CI environments where emulators
 * aren't available.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      // iPhone SE viewport on Chromium (skips the WebKit dependency).
      // The exit criteria call for the layout to render cleanly at
      // 375px width; we get that with viewport overrides alone.
      name: "chromium-mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 375, height: 667 },
        isMobile: true,
        hasTouch: true,
        userAgent: devices["iPhone SE"].userAgent,
      },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: "ignore",
        stderr: "pipe",
        env: {
          NEXT_PUBLIC_USE_FIREBASE_EMULATORS:
            process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS ?? "false",
        },
      },
});
