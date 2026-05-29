"use client";

/**
 * Appearance store — user-tunable, accessibility-minded display
 * preferences that live entirely on the client and persist across
 * sessions via localStorage (zustand `persist`).
 *
 * Two axes, both deliberately independent of the colour theme (which
 * next-themes owns):
 *
 *   • textScale  — global type size. Drives `data-text-scale` on
 *                  <html>; globals.css maps that to a root font-size so
 *                  every rem-based size in the app scales together.
 *   • reduceMotion — "system" respects the OS `prefers-reduced-motion`
 *                  setting (the default); "on"/"off" let a user force it
 *                  either way. Mapped to framer-motion's <MotionConfig
 *                  reducedMotion> so JS-driven animations honour it too,
 *                  not just the CSS media query in globals.css.
 *
 * Persisting through zustand (rather than a useEffect that reads
 * localStorage and setState) keeps hydration synchronous and avoids the
 * cascading-render lint rule entirely.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type TextScale = "sm" | "base" | "lg";
export type ReduceMotion = "system" | "on" | "off";

interface AppearanceState {
  textScale: TextScale;
  reduceMotion: ReduceMotion;
  setTextScale: (s: TextScale) => void;
  setReduceMotion: (r: ReduceMotion) => void;
}

export const useAppearance = create<AppearanceState>()(
  persist(
    (set) => ({
      textScale: "base",
      reduceMotion: "system",
      setTextScale: (textScale) => set({ textScale }),
      setReduceMotion: (reduceMotion) => set({ reduceMotion }),
    }),
    {
      name: "forge.appearance",
      version: 1,
    },
  ),
);

/** Map our tri-state to framer-motion's <MotionConfig reducedMotion>. */
export function toMotionPreference(r: ReduceMotion): "user" | "always" | "never" {
  if (r === "on") return "always";
  if (r === "off") return "never";
  return "user";
}
