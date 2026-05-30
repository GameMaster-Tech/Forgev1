"use client";

/**
 * Optimistic navigation state.
 *
 * `router.push` commits asynchronously — `usePathname()` doesn't reflect the new
 * route until the navigation finishes rendering. That lag made Aria reason
 * against a STALE route (e.g. thinking she was still on /projects right after
 * navigating away), so chained directives misfired.
 *
 * The executor records where it just sent the user here, the instant it fires
 * the navigation; gatherContext prefers this over the (lagging) real pathname.
 * Reality clears it as soon as the pathname actually changes (see useAria), and
 * a short TTL guarantees a stale intent can never lie for long.
 */

let intended: { route: string; at: number } | null = null;
const TTL_MS = 6000;

export function setIntendedRoute(route: string): void {
  intended = { route, at: Date.now() };
}

export function getIntendedRoute(): string | null {
  if (!intended) return null;
  if (Date.now() - intended.at > TTL_MS) {
    intended = null;
    return null;
  }
  return intended.route;
}

export function clearIntendedRoute(): void {
  intended = null;
}
