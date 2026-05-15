"use client";

/**
 * SuggestionCard — single research-gap suggestion.
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ [kind chip]                       •••                    │
 *   │ Title (one line)                                         │
 *   │ Rationale (1-3 sentences)                                │
 *   │                                                          │
 *   │ ┌──────────────┐ ┌──────────────┐                        │
 *   │ │ Add to plan  │ │ Dismiss      │                        │
 *   │ └──────────────┘ └──────────────┘                        │
 *   └──────────────────────────────────────────────────────────┘
 *
 * One tap accept → plan item. One tap dismiss → kind weight decays.
 * Both are optimistic — UI updates immediately; Firestore catches up.
 */

import { motion } from "framer-motion";
import { Plus, X, AlertTriangle, FileQuestion, Library } from "lucide-react";
import type { Suggestion, SuggestionKind } from "@/lib/research-planner";

const KIND_META: Record<
  SuggestionKind,
  { label: string; icon: typeof Plus; accent: string }
> = {
  "undersupported-claim": {
    label: "Undersupported claim",
    icon: FileQuestion,
    accent: "text-warm",
  },
  "underread-topic": {
    label: "Thin coverage",
    icon: Library,
    accent: "text-cyan",
  },
  contradiction: {
    label: "Contradiction",
    icon: AlertTriangle,
    accent: "text-rose",
  },
};

interface Props {
  suggestion: Suggestion;
  onAccept: (s: Suggestion) => void;
  onDismiss: (s: Suggestion) => void;
  /** True while accept/dismiss is in flight — disables buttons. */
  pending?: boolean;
}

export default function SuggestionCard({
  suggestion,
  onAccept,
  onDismiss,
  pending,
}: Props) {
  const meta = KIND_META[suggestion.kind];
  const Icon = meta.icon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8, transition: { duration: 0.15 } }}
      transition={{ duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }}
      className="group relative rounded-xl border border-foreground/10 bg-background p-5 shadow-[0_1px_0_rgba(0,0,0,0.02)] hover:border-violet/40 hover:bg-violet/[0.025]"
    >
      <div className="flex items-center gap-2">
        <Icon size={14} className={meta.accent} strokeWidth={1.75} />
        <span className="text-[10px] uppercase tracking-[0.18em] text-foreground/55">
          {meta.label}
        </span>
        <span className="ml-auto text-[10px] tabular-nums text-foreground/35">
          {Math.round(suggestion.weightedScore * 100)}%
        </span>
      </div>

      <h3 className="mt-2.5 font-display text-base leading-snug text-foreground">
        {suggestion.title}
      </h3>

      <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-foreground/65">
        {suggestion.rationale}
      </p>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => onAccept(suggestion)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Plus size={13} strokeWidth={2} />
          Add to plan
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => onDismiss(suggestion)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/15 px-3 py-1.5 text-xs text-foreground/70 transition-colors hover:border-foreground/30 hover:bg-foreground/[0.03] disabled:opacity-50"
        >
          <X size={13} strokeWidth={1.75} />
          Dismiss
        </button>
      </div>
    </motion.div>
  );
}
