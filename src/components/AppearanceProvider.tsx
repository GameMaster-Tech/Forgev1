"use client";

/**
 * AppearanceProvider — applies the client appearance preferences
 * (text size + motion) to the live document.
 *
 *   • Writes `data-text-scale` onto <html> so the CSS root font-size
 *     rules in globals.css take effect across the whole app.
 *   • Wraps the tree in framer-motion's <MotionConfig> so JS-driven
 *     animations respect the reduced-motion preference — the CSS
 *     `prefers-reduced-motion` query only governs CSS transitions, not
 *     framer's spring/tween values.
 *
 * Mounted once in the root layout, inside ThemeProvider.
 */

import { useEffect, type ReactNode } from "react";
import { MotionConfig } from "framer-motion";
import { useAppearance, toMotionPreference } from "@/store/appearance";

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const textScale = useAppearance((s) => s.textScale);
  const reduceMotion = useAppearance((s) => s.reduceMotion);

  // DOM mutation only (no setState) — safe inside an effect and keeps
  // SSR markup free of a client-only attribute, avoiding hydration drift.
  useEffect(() => {
    const root = document.documentElement;
    if (textScale === "base") {
      delete root.dataset.textScale;
    } else {
      root.dataset.textScale = textScale;
    }
  }, [textScale]);

  // When motion is forced "on" we also flip a CSS hook so plain CSS
  // transitions/animations collapse — framer's MotionConfig only governs
  // JS-driven motion. ("off" can't un-reduce the OS media query via CSS,
  // but MotionConfig still re-enables framer animations.)
  useEffect(() => {
    const root = document.documentElement;
    if (reduceMotion === "on") {
      root.dataset.reduceMotion = "on";
    } else {
      delete root.dataset.reduceMotion;
    }
  }, [reduceMotion]);

  return (
    <MotionConfig reducedMotion={toMotionPreference(reduceMotion)}>
      {children}
    </MotionConfig>
  );
}
