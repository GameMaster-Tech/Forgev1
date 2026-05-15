"use client";

/**
 * CounterCaseCard — one claim ↔ counter-case stacked side-by-side.
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ strength chip · status chip                         •••  │
 *   │ ┌──────────────────────┐ ┌─────────────────────────────┐ │
 *   │ │ YOUR CLAIM           │ │ COUNTER ARGUMENT            │ │
 *   │ │  ...                 │ │  ...                        │ │
 *   │ │                      │ │ Evidence:                   │ │
 *   │ │                      │ │  • snippet …                │ │
 *   │ └──────────────────────┘ └─────────────────────────────┘ │
 *   │ [Refute]  [Concede]  [Defer]                             │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Refute  — user pastes a stronger source / argues back
 * Concede — user adds a caveat to the draft (stored inline)
 * Defer   — keep open intentionally
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sword,
  ShieldCheck,
  HandshakeIcon,
  Clock,
  MoreHorizontal,
  Trash2,
  FileText,
  Quote,
  Globe,
  Link2,
} from "lucide-react";
import type {
  CounterCase,
  CounterCaseStatus,
  CounterStrength,
  CounterEvidence,
} from "@/lib/counterforge";

const STRENGTH_META: Record<
  CounterStrength,
  { label: string; classes: string }
> = {
  strong: {
    label: "Strong counter",
    classes: "text-rose border-rose/40 bg-rose/[0.06]",
  },
  moderate: {
    label: "Moderate counter",
    classes: "text-warm border-warm/40 bg-warm/[0.06]",
  },
  weak: {
    label: "Weak counter",
    classes: "text-foreground/55 border-foreground/15 bg-foreground/[0.03]",
  },
};

const STATUS_META: Record<
  CounterCaseStatus,
  { label: string; classes: string }
> = {
  open: {
    label: "Open",
    classes: "text-foreground/60 border-foreground/15",
  },
  refuted: {
    label: "Refuted",
    classes: "text-violet border-violet/40 bg-violet/[0.06]",
  },
  conceded: {
    label: "Conceded",
    classes: "text-cyan border-cyan/40 bg-cyan/[0.06]",
  },
  deferred: {
    label: "Deferred",
    classes: "text-foreground/50 border-foreground/15",
  },
  stale: {
    label: "Stale",
    classes: "text-foreground/40 border-foreground/10 italic",
  },
};

const EVIDENCE_ICON: Record<CounterEvidence["kind"], typeof FileText> = {
  snippet: Quote,
  claim: ShieldCheck,
  document: FileText,
  web: Globe,
};

interface Props {
  case: CounterCase;
  onRefute: (id: string, source: string) => void;
  onConcede: (id: string, caveat: string) => void;
  onDefer: (id: string) => void;
  onReopen: (id: string) => void;
  onDelete: (id: string) => void;
  pending?: boolean;
}

export default function CounterCaseCard({
  case: c,
  onRefute,
  onConcede,
  onDefer,
  onReopen,
  onDelete,
  pending,
}: Props) {
  const [mode, setMode] = useState<"idle" | "refute" | "concede">("idle");
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  const strength = STRENGTH_META[c.overallStrength];
  const status = STATUS_META[c.status];
  const isClosed = c.status === "refuted" || c.status === "conceded";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }}
      className={`group relative rounded-xl border bg-background p-5 transition-colors ${
        isClosed
          ? "border-foreground/[0.06]"
          : "border-foreground/10 hover:border-violet/40"
      }`}
    >
      {/* Header chips + menu */}
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${strength.classes}`}
        >
          <Sword size={10} strokeWidth={2} />
          {strength.label}
        </span>
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${status.classes}`}
        >
          {status.label}
        </span>
        <div className="relative ml-auto">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded p-1 text-foreground/40 opacity-0 transition-all group-hover:opacity-100 hover:bg-foreground/[0.05] hover:text-foreground/70"
          >
            <MoreHorizontal size={15} strokeWidth={1.75} />
          </button>
          {menuOpen && (
            <>
              <button
                type="button"
                aria-hidden="true"
                tabIndex={-1}
                className="fixed inset-0 z-30 cursor-default"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 top-full z-40 mt-1 w-40 overflow-hidden rounded-lg border border-foreground/15 bg-background shadow-lg">
                {isClosed && (
                  <button
                    type="button"
                    onClick={() => {
                      onReopen(c.id);
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-foreground/80 hover:bg-foreground/[0.04]"
                  >
                    <Clock size={13} strokeWidth={1.75} />
                    Reopen
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    onDelete(c.id);
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-rose hover:bg-rose/[0.06]"
                >
                  <Trash2 size={13} strokeWidth={1.75} />
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Side-by-side */}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-foreground/45">
            Your claim
          </div>
          <p
            className={`mt-1.5 font-display text-[14px] leading-relaxed ${
              c.status === "stale" ? "text-foreground/40 line-through" : "text-foreground"
            }`}
          >
            {c.claimText}
          </p>
        </div>
        <div className="md:border-l md:border-foreground/[0.06] md:pl-4">
          <div className="text-[10px] uppercase tracking-[0.18em] text-rose">
            Counter-argument
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-foreground/80">
            {c.counterArgument}
          </p>
          {c.evidence.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {c.evidence.slice(0, 3).map((ev, i) => {
                const Icon = EVIDENCE_ICON[ev.kind] ?? Quote;
                return (
                  <li
                    key={`${ev.sourceRef ?? "noref"}-${i}`}
                    className="flex items-start gap-2 text-[11px] leading-relaxed text-foreground/55"
                  >
                    <Icon size={11} strokeWidth={1.75} className="mt-[3px] shrink-0 text-rose/70" />
                    <span className="line-clamp-2 italic">{ev.text}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Resolution row */}
      {!isClosed && c.status !== "stale" && (
        <div className="mt-5 border-t border-foreground/[0.06] pt-4">
          <AnimatePresence mode="wait">
            {mode === "idle" && (
              <motion.div
                key="idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-wrap items-center gap-2"
              >
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setMode("refute")}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-violet px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50"
                >
                  <ShieldCheck size={13} strokeWidth={2} />
                  Refute
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setMode("concede")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/15 px-3 py-1.5 text-xs text-foreground/80 transition-colors hover:border-cyan/40 hover:bg-cyan/[0.04] hover:text-foreground disabled:opacity-50"
                >
                  <HandshakeIcon size={13} strokeWidth={1.75} />
                  Concede
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onDefer(c.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-foreground/60 transition-colors hover:bg-foreground/[0.04] hover:text-foreground/80 disabled:opacity-50"
                >
                  <Clock size={13} strokeWidth={1.75} />
                  Defer
                </button>
              </motion.div>
            )}
            {mode === "refute" && (
              <motion.div
                key="refute"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="space-y-2"
              >
                <div className="text-[11px] text-foreground/55">
                  What source or argument defeats this counter?
                </div>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="e.g. Smith et al. 2024 (N=12,000, p<.001) — see /docs/smith-2024"
                  className="w-full resize-none rounded-lg border border-foreground/15 bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-foreground/35 focus:border-violet/50 focus:outline-none"
                  rows={3}
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={pending || !draft.trim()}
                    onClick={() => {
                      onRefute(c.id, draft.trim());
                      setDraft("");
                      setMode("idle");
                    }}
                    className="rounded-lg bg-violet px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50"
                  >
                    Mark refuted
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("idle");
                      setDraft("");
                    }}
                    className="text-xs text-foreground/55 hover:text-foreground/80"
                  >
                    Cancel
                  </button>
                </div>
              </motion.div>
            )}
            {mode === "concede" && (
              <motion.div
                key="concede"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="space-y-2"
              >
                <div className="text-[11px] text-foreground/55">
                  What caveat will you add to the draft?
                </div>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder='e.g. "though replication remains contested in low-income settings"'
                  className="w-full resize-none rounded-lg border border-foreground/15 bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-foreground/35 focus:border-cyan/50 focus:outline-none"
                  rows={3}
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={pending || !draft.trim()}
                    onClick={() => {
                      onConcede(c.id, draft.trim());
                      setDraft("");
                      setMode("idle");
                    }}
                    className="rounded-lg border border-cyan/50 bg-cyan/[0.06] px-3 py-1.5 text-xs font-medium text-cyan hover:bg-cyan/[0.1] disabled:opacity-50"
                  >
                    Mark conceded
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("idle");
                      setDraft("");
                    }}
                    className="text-xs text-foreground/55 hover:text-foreground/80"
                  >
                    Cancel
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Resolution receipt */}
      {(c.status === "refuted" || c.status === "conceded") && (
        <div className="mt-4 rounded-lg border border-foreground/[0.06] bg-foreground/[0.015] p-3 text-[12px] text-foreground/65">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-foreground/45">
            {c.status === "refuted" ? (
              <>
                <ShieldCheck size={11} strokeWidth={2} />
                Refutation
              </>
            ) : (
              <>
                <HandshakeIcon size={11} strokeWidth={1.75} />
                Caveat added
              </>
            )}
          </div>
          {c.status === "refuted" ? c.refutationSource : c.concededCaveat}
        </div>
      )}

      {c.documentId && (
        <div className="mt-3 flex items-center gap-1.5 text-[10px] text-foreground/35">
          <Link2 size={10} strokeWidth={1.75} />
          {c.documentId}
          {typeof c.paragraphIdx === "number" ? ` · ¶${c.paragraphIdx + 1}` : ""}
        </div>
      )}
    </motion.div>
  );
}
