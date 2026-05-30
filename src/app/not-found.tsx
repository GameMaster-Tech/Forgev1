/**
 * not-found.tsx — branded 404 for unmatched routes and `notFound()` calls.
 *
 * Server component; renders inside the root layout so theme + fonts apply.
 * Calm, on-brand, and always offers a next action back into the product.
 */

import Link from "next/link";
import { Compass, ArrowRight } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-24 bg-background text-foreground">
      <div className="max-w-md text-center">
        <div className="inline-flex w-11 h-11 border border-border bg-surface items-center justify-center mb-5">
          <Compass size={18} strokeWidth={1.75} className="text-violet" />
        </div>
        <p className="text-[10px] uppercase tracking-[0.22em] text-muted font-medium mb-3 tabular-nums">
          404
        </p>
        <h1 className="font-display font-bold text-foreground text-3xl sm:text-4xl tracking-[-0.025em] leading-[1.05] mb-4">
          Nothing lives <span className="text-violet">here</span>.
        </h1>
        <p className="text-[13.5px] text-muted leading-relaxed mb-7">
          The page you&apos;re after has moved, been deleted, or never existed.
          Let&apos;s get you back to something useful.
        </p>
        <div className="flex items-center justify-center gap-2.5">
          <Link
            href="/research"
            className="inline-flex items-center gap-2 bg-violet text-white hover:bg-violet/90 text-[11px] font-semibold uppercase tracking-[0.12em] px-5 py-2.5 transition-colors duration-150"
          >
            Open Forge
            <ArrowRight size={12} strokeWidth={2} />
          </Link>
          <Link
            href="/projects"
            className="inline-flex items-center gap-2 border border-border text-foreground hover:border-foreground/30 text-[11px] font-semibold uppercase tracking-[0.12em] px-5 py-2.5 transition-colors duration-150"
          >
            Projects
          </Link>
        </div>
      </div>
    </div>
  );
}
