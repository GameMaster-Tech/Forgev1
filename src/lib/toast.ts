"use client";

/**
 * toast — the single, calm interface for async feedback.
 *
 * Every save / create / delete / AI call / sync should confirm itself.
 * Instead of letting raw `Error.message` strings (Firestore codes, HTTP
 * statuses, stack-y exceptions) leak into the UI, route failures through
 * `humanizeError` so the user always sees something calm and actionable —
 * including the cases that hurt most: rate limits and quota exhaustion.
 *
 * Surfaces should prefer these helpers over importing `sonner` directly so
 * the copy stays consistent and on-brand. The <Toaster> mount lives in the
 * root layout, so `toast*` works from anywhere — app routes, research, and
 * marketing alike.
 */

import { toast } from "sonner";

const GENERIC = "Something went wrong. Please try again.";

/**
 * Translate any thrown value into calm, human, actionable copy. Known
 * failure shapes (rate-limit, quota, network, auth, permissions, backend
 * unavailability) get a tailored line; an already-friendly short message is
 * passed through untouched; anything technical falls back to GENERIC.
 */
export function humanizeError(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "";
  const msg = raw.toLowerCase();

  if (!msg) return GENERIC;

  // ── Rate limits ──────────────────────────────────────────────
  if (
    msg.includes("rate limit") ||
    msg.includes("rate_limit") ||
    msg.includes("too many requests") ||
    msg.includes("429")
  ) {
    return "You're moving fast — give it a few seconds, then try again.";
  }

  // ── Quota / billing ──────────────────────────────────────────
  if (
    msg.includes("quota") ||
    msg.includes("insufficient_quota") ||
    msg.includes("billing") ||
    msg.includes("credit") ||
    msg.includes("usage limit")
  ) {
    return "You've reached your usage limit for now. It resets soon — or upgrade for more headroom.";
  }

  // ── Connectivity ─────────────────────────────────────────────
  if (
    msg.includes("failed to fetch") ||
    msg.includes("network") ||
    msg.includes("offline") ||
    msg.includes("err_network") ||
    msg.includes("load failed")
  ) {
    return "Can't reach the server. Check your connection and try again.";
  }
  if (msg.includes("timed out") || msg.includes("timeout") || msg.includes("etimedout")) {
    return "That took longer than expected. Try again in a moment.";
  }

  // ── Auth / permissions ───────────────────────────────────────
  if (
    msg.includes("permission-denied") ||
    msg.includes("permission denied") ||
    msg.includes("insufficient permissions")
  ) {
    return "You don't have access to do that.";
  }
  if (
    msg.includes("unauthenticated") ||
    msg.includes("not signed in") ||
    msg.includes("401")
  ) {
    return "Your session expired. Sign in again to continue.";
  }

  // ── Backend availability ─────────────────────────────────────
  if (
    (msg.includes("firestore") && (msg.includes("enabled") || msg.includes("rules"))) ||
    msg.includes("unavailable") ||
    msg.includes("503")
  ) {
    return "Can't reach your workspace right now. Try again in a moment.";
  }

  // Already-friendly: a short, prose-y message with no technical noise.
  const looksTechnical = /[{}<>]|stack|exception|\bat \w+\.|err_|0x[0-9a-f]/i.test(raw);
  if (raw.length <= 120 && !looksTechnical) return raw;

  return GENERIC;
}

/** Calm failure toast. `fallback` is used when the error can't be humanized. */
export function toastError(err: unknown, fallback?: string): void {
  const message = humanizeError(err);
  toast.error(message === GENERIC && fallback ? fallback : message);
}

/** Success confirmation, optionally with a secondary description line. */
export function toastSuccess(message: string, description?: string): void {
  toast.success(message, description ? { description } : undefined);
}

/** Neutral, informational toast. */
export function toastInfo(message: string, description?: string): void {
  toast(message, description ? { description } : undefined);
}

/**
 * Wrap an async operation with optimistic loading / success / error toasts.
 * Returns the resolved value so callers can keep their control flow.
 */
export async function withToast<T>(
  op: () => Promise<T>,
  copy: { loading: string; success: string; error?: string },
): Promise<T> {
  const id = toast.loading(copy.loading);
  try {
    const result = await op();
    toast.success(copy.success, { id });
    return result;
  } catch (err) {
    toast.error(humanizeError(err) , { id });
    throw err;
  }
}
