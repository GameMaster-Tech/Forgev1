"use client";

/**
 * (app)/error.tsx — segment error boundary for every authed app route.
 *
 * Wraps page.js + nested layouts under (app) in a React error boundary, so
 * a runtime render crash shows this calm, branded fallback inside the
 * AppShell (sidebar stays usable) instead of a blank screen. Next 16
 * passes `unstable_retry` (v16.2.0) to re-fetch + re-render the segment;
 * we keep `reset` as a fallback for older behaviour.
 */

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCw, ArrowLeft } from "lucide-react";

export default function AppError({
  error,
  unstable_retry,
  reset,
}: {
  error: Error & { digest?: string };
  unstable_retry?: () => void;
  reset?: () => void;
}) {
  useEffect(() => {
    console.error("App route error:", error);
  }, [error]);

  const retry = unstable_retry ?? reset ?? (() => window.location.reload());

  return (
    <div className="min-h-full flex items-center justify-center px-6 py-24 bg-background">
      <div className="max-w-md text-center">
        <div className="inline-flex w-11 h-11 border border-rose/40 bg-rose/[0.06] items-center justify-center mb-5">
          <AlertTriangle size={18} strokeWidth={1.75} className="text-rose" />
        </div>
        <p className="text-[10px] uppercase tracking-[0.22em] text-muted font-medium mb-3">
          Something broke
        </p>
        <h1 className="font-display font-bold text-foreground text-2xl sm:text-3xl tracking-[-0.022em] leading-[1.1] mb-3">
          This page hit a <span className="text-rose">snag</span>.
        </h1>
        <p className="text-[13.5px] text-muted leading-relaxed mb-7">
          The rest of Forge is fine, and your work is saved. Try reloading this
          view — if it keeps happening, head back and come at it fresh.
        </p>
        {error?.digest ? (
          <p className="text-[10px] text-muted/60 tabular-nums mb-6 font-mono">
            ref: {error.digest}
          </p>
        ) : null}
        <div className="flex items-center justify-center gap-2.5">
          <button
            type="button"
            onClick={() => retry()}
            className="inline-flex items-center gap-2 bg-violet text-white hover:bg-violet/90 text-[11px] font-semibold uppercase tracking-[0.12em] px-5 py-2.5 transition-colors duration-150"
          >
            <RotateCw size={12} strokeWidth={2} />
            Try again
          </button>
          <Link
            href="/projects"
            className="inline-flex items-center gap-2 border border-border text-foreground hover:border-foreground/30 text-[11px] font-semibold uppercase tracking-[0.12em] px-5 py-2.5 transition-colors duration-150"
          >
            <ArrowLeft size={12} strokeWidth={2} />
            Projects
          </Link>
        </div>
      </div>
    </div>
  );
}
