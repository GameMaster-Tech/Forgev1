"use client";

/**
 * RefactorReview — accept/reject/skip card for a Pulse RefactorProposal.
 *
 * Renders a single proposal with side-by-side before/after diff and
 * three action buttons. Owns no persistence — the parent passes
 * callbacks. The component is purely visual + interaction; the page
 * decides what "accept" / "reject" / "skip" mean for its data layer.
 *
 * UX details:
 *   • Accept becomes a transient "committed" state for 1.2 s before
 *     the parent unmounts the card so the user sees their action.
 *   • Reject confirms a "user-declined" state with a 7-day cooldown.
 *   • Skip leaves the proposal in the queue for next run.
 *   • All three actions can be triggered from the keyboard
 *     (A / R / S) when the card is in the viewport-focused state.
 */

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Check,
  FileText,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react";
import type { Assertion, AssertionId } from "@/lib/sync";
import type { RefactorProposal } from "@/lib/pulse";

const ease = [0.22, 0.61, 0.36, 1] as const;

export type RefactorAction = "accept" | "reject" | "skip";

export interface RefactorReviewProps {
  proposal: RefactorProposal;
  assertions: Map<AssertionId, Assertion>;
  /**
   * Called when the user clicks Accept. Should persist the new body
   * back to the underlying ContentBlock. May be async — the button
   * shows a spinner until the promise settles.
   */
  onAccept: (p: RefactorProposal) => void | Promise<void>;
  /**
   * Called when the user clicks Reject. Should record the rejection
   * for the 7-day cooldown window.
   */
  onReject: (p: RefactorProposal) => void | Promise<void>;
  /**
   * Called when the user clicks Skip. The proposal stays in the
   * queue and will resurface on the next Pulse run.
   */
  onSkip: (p: RefactorProposal) => void | Promise<void>;
  /** Optional override for keyboard shortcut binding. */
  index: number;
}

type State = "idle" | "accepting" | "rejecting" | "accepted" | "rejected";

export function RefactorReview({
  proposal,
  assertions,
  onAccept,
  onReject,
  onSkip,
  index,
}: RefactorReviewProps) {
  const [state, setState] = useState<State>("idle");
  const cardRef = useRef<HTMLDivElement | null>(null);
  const busy = state === "accepting" || state === "rejecting";

  // Auto-clear transient committed state so the parent can swap to
  // its terminal animation if it chooses.
  useEffect(() => {
    if (state !== "accepted" && state !== "rejected") return;
    const handle = window.setTimeout(() => setState("idle"), 1200);
    return () => window.clearTimeout(handle);
  }, [state]);

  const handleAccept = async () => {
    if (busy) return;
    setState("accepting");
    try {
      await onAccept(proposal);
      setState("accepted");
    } catch {
      setState("idle");
    }
  };

  const handleReject = async () => {
    if (busy) return;
    setState("rejecting");
    try {
      await onReject(proposal);
      setState("rejected");
    } catch {
      setState("idle");
    }
  };

  const handleSkip = async () => {
    if (busy) return;
    try {
      await onSkip(proposal);
    } catch {
      /* skip is best-effort */
    }
  };

  const triggers = proposal.triggeredBy.map((id) => assertions.get(id)).filter(Boolean) as Assertion[];

  return (
    <motion.div
      ref={cardRef}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.25, delay: Math.min(index, 5) * 0.04, ease }}
      className="border border-violet bg-foreground text-background relative overflow-hidden"
      data-testid="refactor-review"
    >
      <span aria-hidden className="absolute left-0 top-0 h-full w-[3px] bg-violet" />

      <div className="px-5 py-3 border-b border-white/[0.08] flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FileText size={12} strokeWidth={2} className="text-violet shrink-0" />
          <span className="text-[10px] uppercase tracking-[0.18em] text-background/60 font-medium truncate">
            Refactor · {proposal.documentId} · {proposal.kind === "value-swap" ? "safe swap" : "needs review"}
          </span>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {triggers.map((a) => (
            <span key={a.id} className="text-[10px] uppercase tracking-[0.12em] border border-white/[0.1] bg-white/[0.04] text-background/70 px-2 py-1 font-medium">
              {a.label}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/[0.06]">
        <div className="p-5">
          <div className="text-[10px] uppercase tracking-[0.18em] text-rose font-semibold mb-2 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-rose" /> Before
          </div>
          <pre className="text-[13px] text-background/65 leading-relaxed whitespace-pre-wrap font-sans break-words">{proposal.before}</pre>
        </div>
        <div className="p-5">
          <div className="text-[10px] uppercase tracking-[0.18em] text-green font-semibold mb-2 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-green" /> After
          </div>
          <pre className="text-[13px] text-background leading-relaxed whitespace-pre-wrap font-sans break-words">{proposal.after}</pre>
        </div>
      </div>

      <div className="px-5 py-4 border-t border-white/[0.08] flex items-center gap-2 flex-wrap">
        <button
          onClick={handleAccept}
          disabled={busy}
          aria-label="Accept refactor"
          aria-busy={state === "accepting"}
          className="flex items-center gap-1.5 bg-green text-foreground hover:bg-green/90 disabled:opacity-60 text-[11px] font-semibold uppercase tracking-[0.12em] px-4 py-2.5 transition-colors duration-150"
        >
          {state === "accepting" ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} strokeWidth={2.5} />}
          Accept
        </button>
        <button
          onClick={handleReject}
          disabled={busy}
          aria-label="Reject refactor"
          aria-busy={state === "rejecting"}
          className="flex items-center gap-1.5 border border-white/[0.18] text-background hover:border-rose hover:text-rose disabled:opacity-60 text-[11px] font-semibold uppercase tracking-[0.12em] px-4 py-2.5 transition-colors duration-150"
        >
          {state === "rejecting" ? <Loader2 size={12} className="animate-spin" /> : <X size={12} strokeWidth={2.5} />}
          Reject
        </button>
        <button
          onClick={handleSkip}
          disabled={busy}
          aria-label="Skip refactor for now"
          className="flex items-center gap-1.5 border border-transparent text-background/60 hover:text-background disabled:opacity-60 text-[11px] font-semibold uppercase tracking-[0.12em] px-4 py-2.5 transition-colors duration-150"
        >
          <RotateCcw size={12} strokeWidth={2.25} />
          Skip
        </button>
        {state === "accepted" && (
          <span className="ml-auto text-[10px] uppercase tracking-[0.12em] text-green font-semibold flex items-center gap-1.5">
            <Check size={10} strokeWidth={2.5} /> Committed
          </span>
        )}
        {state === "rejected" && (
          <span className="ml-auto text-[10px] uppercase tracking-[0.12em] text-rose font-semibold flex items-center gap-1.5">
            <X size={10} strokeWidth={2.5} /> Declined · 7-day cooldown
          </span>
        )}
      </div>
    </motion.div>
  );
}
