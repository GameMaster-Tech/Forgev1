"use client";

/**
 * Toaster — the single, app-wide mount point for Sonner toasts.
 *
 * Several surfaces (CounterforgePanel, ResearchPlannerPanel, Settings…)
 * call `toast()` / `toast.error()` from "sonner", but until this was
 * mounted there was no <Toaster> in the tree, so none of those
 * notifications ever rendered. Mounting once at the root layout makes
 * `toast(...)` work from anywhere — authed app routes, research, and
 * marketing alike.
 *
 * Styling is deliberately on-brand for Forge: square corners, a 1px
 * border, the body font, and violet/green/red accent borders for the
 * action button and status variants. The toast theme follows the live
 * next-themes value so dark mode reads correctly.
 */

import { Toaster as SonnerToaster } from "sonner";
import { useTheme } from "next-themes";

export function Toaster() {
  const { resolvedTheme } = useTheme();

  return (
    <SonnerToaster
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      position="bottom-right"
      gap={10}
      offset={20}
      toastOptions={{
        classNames: {
          toast:
            "!rounded-none !border !border-border !bg-background !text-foreground !shadow-[0_18px_50px_-24px_rgba(0,0,0,0.55)] !font-sans",
          title: "!text-[13px] !font-semibold !tracking-[-0.01em]",
          description: "!text-[12px] !text-muted !leading-relaxed",
          actionButton:
            "!rounded-none !bg-violet !text-white !text-[11px] !font-semibold !uppercase !tracking-[0.12em]",
          cancelButton:
            "!rounded-none !bg-surface-light !text-muted !text-[11px] !font-semibold !uppercase !tracking-[0.12em]",
          icon: "!text-violet",
          success: "!border-green/40",
          error: "!border-red/40",
        },
      }}
    />
  );
}
