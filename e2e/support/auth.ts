import type { Page } from "@playwright/test";

/**
 * Auth harness for the e2e suite.
 *
 * Two modes, picked via `NEXT_PUBLIC_USE_FIREBASE_EMULATORS`:
 *
 *   true  — drive the real /auth/login form against the Firebase Auth
 *           emulator (or a real test tenant). Caller supplies email +
 *           password via env vars.
 *   false — stub the Firebase Auth client by injecting a synthetic
 *           authenticated user into the page before navigation. Lets
 *           the suite run in CI environments without an emulator.
 *
 * Both paths land on `/research` and resolve when the AuthGuard has
 * released the page (the URL is no longer `/auth/login`).
 */

const USE_EMULATOR = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true";

export interface E2EUser {
  uid: string;
  email: string;
  displayName: string;
}

const DEFAULT_USER: E2EUser = {
  uid: "e2e-user-fixture",
  email: process.env.PLAYWRIGHT_E2E_USER_EMAIL ?? "e2e@forge.test",
  displayName: "E2E Tester",
};

/**
 * Sign the page session in. After this resolves, navigating to any
 * `/app/(app)/...` route renders without bouncing through the login.
 */
export async function signIn(page: Page, user: E2EUser = DEFAULT_USER): Promise<void> {
  if (USE_EMULATOR) {
    await signInViaForm(page, user);
    return;
  }
  await stubAuthIntoBrowser(page, user);
}

async function signInViaForm(page: Page, user: E2EUser): Promise<void> {
  const password = process.env.PLAYWRIGHT_E2E_USER_PASSWORD ?? "playwright-secret-not-real";
  await page.goto("/auth/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /^log in$/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/"));
}

/**
 * Stub mode — patches the Firebase client on the window before the app
 * boots. `onAuthStateChanged` resolves synchronously with the fake
 * user, so the AuthGuard renders children immediately and no network
 * call is made.
 */
async function stubAuthIntoBrowser(page: Page, user: E2EUser): Promise<void> {
  await page.addInitScript((u: E2EUser) => {
    // Stash on window so the test can introspect.
    (window as unknown as { __E2E_USER: E2EUser }).__E2E_USER = u;

    // Patch the Firebase modular Auth surface. The app imports `auth` from
    // `@/lib/firebase/config`; we intercept the `onAuthStateChanged` and
    // `signOut` symbols at the module level via a global hook the auth
    // context reads. The AuthContext checks for `window.__E2E_AUTH` first.
    (window as unknown as Record<string, unknown>).__E2E_AUTH = {
      currentUser: { uid: u.uid, email: u.email, displayName: u.displayName },
    };
  }, user);
}
