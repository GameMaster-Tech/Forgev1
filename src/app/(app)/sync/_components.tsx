"use client";

/**
 * Shared primitives for the /sync section.
 *
 * Underscore-prefixed so Next's route discovery skips it. Hosts the
 * value formatter and a couple of small presentational atoms reused
 * across overview / conflicts / patch / documents / history.
 */

import type { Assertion } from "@/lib/sync";

export const ease = [0.22, 0.61, 0.36, 1] as const;

/** Stringify a structured Assertion value for inline rendering. */
export function describeValue(v: Assertion["value"] | null | undefined): string {
  if (!v) return "—";
  switch (v.type) {
    case "number":  return `${v.value.toLocaleString()}${v.unit ? " " + v.unit : ""}`;
    case "string":  return `"${v.value}"`;
    case "date":    return v.value;
    case "boolean": return v.value ? "true" : "false";
  }
}
