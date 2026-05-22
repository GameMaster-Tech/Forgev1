"use client";

/**
 * ContradictionBanner — surfaces intra-document contradictions found
 * by `useDocContradictions`. Quiet when nothing's flagged; expands
 * into a tight stack of cards (one per detected pair) when there is.
 *
 * Clicking a card calls `onJump` with the verbatim span the editor
 * should scroll to + highlight (the parent supplies the jump-to-text
 * affordance via the existing `EditorHandle.jumpToText`).
 */

import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import type { IntradocContradiction } from "@/hooks/useDocContradictions";

const EASE = [0.22, 0.61, 0.36, 1] as const;

interface ContradictionBannerProps {
  contradictions: IntradocContradiction[];
  scanning: boolean;
  /** True when the doc has been edited since the last scan. */
  staleSinceLastScan?: boolean;
  /** True once the user has at least one scan result (clean or not). */
  hasScanned?: boolean;
  onJump?: (text: string) => void;
  onRescan?: () => void;
}

export function ContradictionBanner({
  contradictions,
  scanning,
  staleSinceLastScan = false,
  hasScanned = false,
  onJump,
  onRescan,
}: ContradictionBannerProps) {
  const [open, setOpen] = useState(true);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  const visible = contradictions.filter(
    (c) => !dismissed.has(`${c.spanA}::${c.spanB}`),
  );

  // Show a tight in-progress state while a scan is in flight.
  if (scanning) {
    return (
      <div className="border border-border bg-surface/60 px-4 py-2 text-[10px] uppercase tracking-[0.18em] text-muted font-medium inline-flex items-center gap-2">
        <Loader2 size={10} className="animate-spin" />
        Checking for contradictions…
      </div>
    );
  }

  // After a clean scan: tiny "no contradictions" pill with a re-check
  // affordance. Only shows once the user has actually scanned.
  if (visible.length === 0 && hasScanned) {
    return (
      <div className="flex items-center gap-3 border border-border bg-surface/60 px-4 py-2 text-[10px] uppercase tracking-[0.16em] font-medium">
        <CheckCircle2 size={11} strokeWidth={2} className="text-green" />
        <span className="text-green">No contradictions found</span>
        {staleSinceLastScan ? (
          <span className="text-muted">· doc edited since last check</span>
        ) : null}
        {onRescan ? (
          <button
            type="button"
            onClick={onRescan}
            className="ml-auto inline-flex items-center gap-1.5 text-violet hover:underline"
          >
            <RefreshCw size={10} strokeWidth={2} />
            Re-check
          </button>
        ) : null}
      </div>
    );
  }

  if (visible.length === 0) {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        key="contradiction-banner"
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.22, ease: EASE }}
        className="border border-rose/40 bg-rose/[0.04]"
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center gap-3 px-4 py-2.5"
        >
          <AlertTriangle size={12} strokeWidth={2} className="text-rose shrink-0" />
          <span className="text-[10px] uppercase tracking-[0.18em] font-semibold text-rose">
            {visible.length} contradiction{visible.length === 1 ? "" : "s"} in this document
          </span>
          {scanning ? (
            <Loader2 size={11} className="text-rose/60 animate-spin" />
          ) : null}
          <span className="ml-auto text-rose/70">
            {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </span>
        </button>
        {open ? (
          <ul className="border-t border-rose/30">
            {visible.map((c, i) => {
              const key = `${c.spanA}::${c.spanB}`;
              return (
                <li
                  key={key}
                  className={`px-4 py-3 ${i > 0 ? "border-t border-rose/20" : ""}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0 space-y-2">
                      <ContradictionSpan
                        label="Statement A"
                        text={c.spanA}
                        onJump={onJump}
                      />
                      <ContradictionSpan
                        label="Statement B"
                        text={c.spanB}
                        onJump={onJump}
                      />
                      {c.reason ? (
                        <p className="text-[12px] text-foreground/80 leading-relaxed pt-1">
                          <span className="text-[9px] uppercase tracking-[0.16em] font-semibold text-rose mr-2">
                            Why
                          </span>
                          {c.reason}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setDismissed((prev) => {
                          const next = new Set(prev);
                          next.add(key);
                          return next;
                        })
                      }
                      aria-label="Dismiss"
                      className="text-rose/50 hover:text-rose transition-colors p-1"
                    >
                      <X size={11} strokeWidth={2} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </motion.div>
    </AnimatePresence>
  );
}

function ContradictionSpan({
  label,
  text,
  onJump,
}: {
  label: string;
  text: string;
  onJump?: (text: string) => void;
}) {
  return (
    <button
      type="button"
      disabled={!onJump}
      onClick={() => onJump?.(text)}
      className="w-full text-left group flex items-baseline gap-2 disabled:cursor-default"
    >
      <span className="text-[9px] uppercase tracking-[0.16em] font-semibold text-rose shrink-0 mt-0.5">
        {label}
      </span>
      <span className="text-[12.5px] text-foreground/90 leading-snug group-hover:text-rose group-disabled:hover:text-foreground/90 transition-colors line-clamp-3">
        “{text}”
      </span>
    </button>
  );
}
