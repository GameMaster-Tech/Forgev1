"use client";

/**
 * Sync — Conflict detail.
 *
 * One violation, in full. The detail page promotes the full message
 * to display-type, breaks out every involved variable as a chip
 * (with locked-state indicators), and provides prev/next navigation
 * across the same severity-sorted list the user sees on the index.
 * Includes a CTA into the proposed patch so the user can act.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  Lock,
  Sparkles,
  TrendingDown,
} from "lucide-react";
import type { Assertion, Violation } from "@/lib/sync";
import { useSync } from "../../SyncProvider";
import { describeValue, ease } from "../../_components";

export default function SyncConflictDetailPage() {
  const params = useParams<{ constraintId: string }>();
  const { violations, assertionsById } = useSync();

  const targetId = useMemo(() => {
    const raw = params?.constraintId;
    if (!raw) return null;
    try { return decodeURIComponent(String(raw)); } catch { return String(raw); }
  }, [params]);

  // Same ordering as the list page.
  const ordered = useMemo(() => {
    return [...violations].sort(
      (a, b) =>
        (a.severity === b.severity ? 0 : a.severity === "hard" ? -1 : 1) || b.magnitude - a.magnitude,
    );
  }, [violations]);

  const index = useMemo(
    () => ordered.findIndex((v) => v.constraintId === targetId),
    [ordered, targetId],
  );
  const violation = index >= 0 ? ordered[index] : null;
  const prev = index > 0 ? ordered[index - 1] : null;
  const next = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null;

  if (!violation) {
    return (
      <div className="max-w-4xl mx-auto px-6 sm:px-10 pt-10 pb-16">
        <Link
          href="/sync/conflicts"
          prefetch
          className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-muted hover:text-foreground font-medium mb-6"
        >
          <ArrowLeft size={11} strokeWidth={2} />
          Back to conflicts
        </Link>
        <div className="border border-border bg-surface px-6 py-10 text-center">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
            Resolved
          </p>
          <h3 className="font-display font-bold text-foreground text-[20px] tracking-[-0.018em] mb-2">
            This conflict is <span className="text-violet">no longer in the workspace</span>.
          </h3>
          <p className="text-[13px] text-muted leading-relaxed mb-5 max-w-md mx-auto">
            A compile may have applied a patch since this URL was generated. Open the queue to see what&apos;s still outstanding.
          </p>
          <Link
            href="/sync/conflicts"
            prefetch
            className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] font-semibold text-violet hover:underline"
          >
            Back to conflicts
            <ArrowRight size={11} strokeWidth={2} />
          </Link>
        </div>
      </div>
    );
  }

  const isHard = violation.severity === "hard";
  const accent = isHard ? "bg-rose"   : "bg-warm";
  const tone   = isHard ? "text-rose" : "text-warm";
  const involved = violation.involved
    .map((id) => assertionsById.get(id))
    .filter((a): a is Assertion => !!a);

  return (
    <div className="max-w-5xl mx-auto px-6 sm:px-10 pt-8 pb-16">
      <Link
        href="/sync/conflicts"
        prefetch
        className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-muted hover:text-foreground font-medium mb-5"
      >
        <ArrowLeft size={11} strokeWidth={2} />
        All conflicts
      </Link>

      <NavBar index={index} total={ordered.length} prev={prev} next={next} />

      <motion.div
        key={violation.constraintId}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease }}
        className="mt-6 border border-border bg-surface p-5 sm:p-7 relative"
      >
        <span aria-hidden className={`absolute left-0 top-7 bottom-7 w-[2px] ${accent}`} />

        <div className="flex items-center gap-2.5 mb-2 flex-wrap">
          <span className={`flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] font-semibold ${tone}`}>
            <GitBranch size={11} strokeWidth={2} />
            {isHard ? "Hard conflict" : "Soft warning"}
          </span>
          <span className="w-1 h-1 bg-muted rounded-full" />
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums inline-flex items-center gap-1">
            <TrendingDown size={9} /> Δ {violation.magnitude.toLocaleString()}
          </span>
        </div>

        <h2 className="font-display font-bold text-foreground text-2xl sm:text-3xl tracking-[-0.022em] leading-[1.15]">
          {violation.message}
        </h2>

        {involved.length > 0 && (
          <div className="mt-6 pt-5 border-t border-border-light">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
              Variables involved · {involved.length}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {involved.map((a) => (
                <div
                  key={a.id}
                  className="border border-border bg-background px-4 py-3 relative"
                >
                  {a.locked && (
                    <span aria-hidden className="absolute right-3 top-3 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-violet font-medium">
                      <Lock size={9} /> locked
                    </span>
                  )}
                  <div className="text-[10px] uppercase tracking-[0.15em] text-muted font-semibold mb-1">
                    {a.kind}
                  </div>
                  <div className="font-display font-bold text-foreground text-[15px] tracking-[-0.018em] leading-tight truncate">
                    {a.label}
                  </div>
                  <div className="text-[12px] text-muted leading-relaxed mt-1 tabular-nums">
                    {describeValue(a.value)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 pt-5 border-t border-border-light flex items-center gap-3 flex-wrap">
          <Link
            href="/sync/patch"
            prefetch
            className="inline-flex items-center gap-2 bg-violet text-white hover:bg-violet/90 text-[11px] font-semibold uppercase tracking-[0.12em] px-5 py-2.5 transition-colors duration-150"
          >
            <Sparkles size={12} strokeWidth={2.25} />
            See proposed patch
          </Link>
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium truncate">
            constraint · {violation.constraintId}
          </span>
        </div>
      </motion.div>
    </div>
  );
}

/* ── nav bar ───────────────────────────────────────────────── */

function NavBar({
  index, total, prev, next,
}: {
  index: number;
  total: number;
  prev: Violation | null;
  next: Violation | null;
}) {
  return (
    <div className="border border-border bg-surface flex items-stretch">
      <PrevNextButton direction="prev" violation={prev} disabled={!prev} />
      <div className="flex-1 flex items-center justify-center px-4 py-3 border-x border-border">
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium tabular-nums">
          #{String(index + 1).padStart(2, "0")} of {total}
        </span>
      </div>
      <PrevNextButton direction="next" violation={next} disabled={!next} />
    </div>
  );
}

function PrevNextButton({
  direction, violation, disabled,
}: {
  direction: "prev" | "next";
  violation: Violation | null;
  disabled: boolean;
}) {
  const isPrev = direction === "prev";
  if (disabled || !violation) {
    return (
      <div className={`flex-1 min-w-0 px-4 py-3 flex items-center gap-2 text-muted/50 ${isPrev ? "justify-start" : "justify-end"}`}>
        {isPrev && <ChevronLeft size={12} strokeWidth={2} />}
        <span className="text-[10px] uppercase tracking-[0.12em] font-semibold">
          {isPrev ? "First in list" : "Last in list"}
        </span>
        {!isPrev && <ChevronRight size={12} strokeWidth={2} />}
      </div>
    );
  }
  return (
    <Link
      href={`/sync/conflicts/${encodeURIComponent(violation.constraintId)}`}
      prefetch
      className={`flex-1 min-w-0 px-4 py-3 flex items-center gap-2 text-foreground hover:bg-violet/[0.06] hover:text-violet transition-colors group ${isPrev ? "justify-start" : "justify-end"}`}
    >
      {isPrev && <ChevronLeft size={12} strokeWidth={2} className="group-hover:-translate-x-0.5 transition-transform" />}
      <div className={`min-w-0 ${isPrev ? "text-left" : "text-right"}`}>
        <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted group-hover:text-violet transition-colors">
          {isPrev ? "Prev" : "Next"}
        </div>
        <div className="text-[12px] font-medium text-foreground truncate">
          {violation.severity === "hard" ? "Hard" : "Soft"} · Δ {violation.magnitude.toLocaleString()}
        </div>
      </div>
      {!isPrev && <ChevronRight size={12} strokeWidth={2} className="group-hover:translate-x-0.5 transition-transform" />}
    </Link>
  );
}
