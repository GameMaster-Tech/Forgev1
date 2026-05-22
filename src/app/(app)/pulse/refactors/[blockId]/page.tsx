"use client";

/**
 * Pulse — Refactor detail.
 *
 * One refactor, in peace. Reached by clicking a card on /pulse/refactors.
 * Provides:
 *   • Breadcrumb back to the queue
 *   • #N of M position indicator with Prev / Next navigation across
 *     the current queue (filter-agnostic — always uses the full queue)
 *   • The full RefactorReview card
 *   • Auto-advance: after accept/reject, navigate to the next pending
 *     refactor; if the queue is empty, return to /pulse/refactors with
 *     its inbox-zero celebration.
 */

import { useMemo, useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { RefactorReview } from "@/components/pulse/RefactorReview";
import type { RefactorProposal } from "@/lib/pulse";
import { usePulse } from "../../PulseProvider";
import { ease } from "../../_components";

export default function PulseRefactorDetailPage() {
  const params = useParams<{ blockId: string }>();
  const router = useRouter();
  const { run, assertionMap, acceptRefactor, rejectRefactor, skipRefactor } = usePulse();

  const targetBlockId = useMemo(() => {
    const raw = params?.blockId;
    if (!raw) return null;
    try { return decodeURIComponent(String(raw)); } catch { return String(raw); }
  }, [params]);

  const proposals = run?.refactorProposals ?? [];
  const index = useMemo(
    () => proposals.findIndex((p) => p.blockId === targetBlockId),
    [proposals, targetBlockId],
  );

  // Adjacent items for prev/next nav.
  const prev: RefactorProposal | null = index > 0 ? proposals[index - 1] : null;
  const next: RefactorProposal | null = index >= 0 && index < proposals.length - 1 ? proposals[index + 1] : null;

  const goToNextOrList = useCallback(() => {
    // After resolution, prefer the proposal that just shifted into our
    // slot (same index). If we were at the end, fall back to whatever
    // came before us, or finally to the list.
    const fallback = next ?? prev;
    if (fallback) {
      router.push(`/pulse/refactors/${encodeURIComponent(fallback.blockId)}`);
    } else {
      router.push("/pulse/refactors");
    }
  }, [next, prev, router]);

  // ── Hydrating
  if (!run) {
    return (
      <div className="max-w-4xl mx-auto px-6 sm:px-10 pt-10 pb-16">
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-4">
          Hydrating
        </p>
        <h2 className="font-display font-bold text-foreground text-2xl sm:text-3xl tracking-[-0.022em] leading-[1.1]">
          Running first <span className="text-violet">sync</span>…
        </h2>
      </div>
    );
  }

  // ── Not found (URL points to a resolved/non-existent refactor)
  if (index < 0) {
    return (
      <div className="max-w-4xl mx-auto px-6 sm:px-10 pt-10 pb-16">
        <Link
          href="/pulse/refactors"
          prefetch
          className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-muted hover:text-foreground font-medium mb-6"
        >
          <ArrowLeft size={11} strokeWidth={2} />
          Back to refactors
        </Link>
        <div className="border border-border bg-surface px-6 py-10 text-center">
          <div className="inline-flex items-center justify-center w-10 h-10 border border-border bg-background mb-4">
            <CheckCircle2 size={16} className="text-green" strokeWidth={2} />
          </div>
          <h3 className="font-display font-bold text-foreground text-[20px] tracking-[-0.018em] mb-2">
            Already <span className="text-violet">resolved</span>.
          </h3>
          <p className="text-[13px] text-muted leading-relaxed mb-5 max-w-md mx-auto">
            This refactor is no longer in the pending queue — it&apos;s either been accepted, rejected, or invalidated by a fresh Pulse run.
          </p>
          <Link
            href="/pulse/refactors"
            prefetch
            className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] font-semibold text-violet hover:underline"
          >
            Back to the queue
            <ArrowRight size={11} strokeWidth={2} />
          </Link>
        </div>
      </div>
    );
  }

  const proposal = proposals[index];

  const handleAccept = async (p: RefactorProposal) => {
    await acceptRefactor(p);
    goToNextOrList();
  };
  const handleReject = async (p: RefactorProposal) => {
    await rejectRefactor(p);
    goToNextOrList();
  };
  const handleSkip = (p: RefactorProposal) => {
    skipRefactor(p);
    goToNextOrList();
  };

  return (
    <div className="max-w-5xl mx-auto px-6 sm:px-10 pt-8 pb-16">
      {/* breadcrumb */}
      <Link
        href="/pulse/refactors"
        prefetch
        className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-muted hover:text-foreground font-medium mb-5"
      >
        <ArrowLeft size={11} strokeWidth={2} />
        All refactors
      </Link>

      {/* nav bar: prev | position | next */}
      <NavBar
        index={index}
        total={proposals.length}
        prev={prev}
        next={next}
      />

      {/* the refactor itself */}
      <motion.div
        key={proposal.blockId}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease }}
        className="mt-6"
      >
        <RefactorReview
          proposal={proposal}
          assertions={assertionMap}
          onAccept={handleAccept}
          onReject={handleReject}
          onSkip={handleSkip}
          index={index}
        />
      </motion.div>
    </div>
  );
}

/* ── Prev / Position / Next bar ────────────────────────────── */

function NavBar({
  index, total, prev, next,
}: {
  index: number;
  total: number;
  prev: RefactorProposal | null;
  next: RefactorProposal | null;
}) {
  return (
    <div className="border border-border bg-surface flex items-stretch">
      <PrevNextButton
        direction="prev"
        proposal={prev}
        disabled={!prev}
      />
      <div className="flex-1 flex items-center justify-center px-4 py-3 border-x border-border">
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium tabular-nums">
          #{String(index + 1).padStart(2, "0")} of {total}
        </span>
      </div>
      <PrevNextButton
        direction="next"
        proposal={next}
        disabled={!next}
      />
    </div>
  );
}

function PrevNextButton({
  direction, proposal, disabled,
}: {
  direction: "prev" | "next";
  proposal: RefactorProposal | null;
  disabled: boolean;
}) {
  const isPrev = direction === "prev";
  if (disabled || !proposal) {
    return (
      <div
        className={`flex-1 min-w-0 px-4 py-3 flex items-center gap-2 text-muted/50 ${isPrev ? "justify-start" : "justify-end"}`}
        aria-disabled
      >
        {isPrev && <ChevronLeft size={12} strokeWidth={2} />}
        <span className="text-[10px] uppercase tracking-[0.12em] font-semibold">
          {isPrev ? "First in queue" : "Last in queue"}
        </span>
        {!isPrev && <ChevronRight size={12} strokeWidth={2} />}
      </div>
    );
  }
  return (
    <Link
      href={`/pulse/refactors/${encodeURIComponent(proposal.blockId)}`}
      prefetch
      className={`flex-1 min-w-0 px-4 py-3 flex items-center gap-2 text-foreground hover:bg-violet/[0.06] hover:text-violet transition-colors group ${isPrev ? "justify-start" : "justify-end"}`}
      aria-label={isPrev ? "Previous refactor" : "Next refactor"}
    >
      {isPrev && <ChevronLeft size={12} strokeWidth={2} className="group-hover:-translate-x-0.5 transition-transform" />}
      <div className={`min-w-0 ${isPrev ? "text-left" : "text-right"}`}>
        <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted group-hover:text-violet transition-colors">
          {isPrev ? "Prev" : "Next"}
        </div>
        <div className="text-[12px] font-medium text-foreground truncate">
          {proposal.blockId}
        </div>
      </div>
      {!isPrev && <ChevronRight size={12} strokeWidth={2} className="group-hover:translate-x-0.5 transition-transform" />}
    </Link>
  );
}
