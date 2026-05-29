"use client";

/**
 * CalmReview — the calm psychology surface.
 *
 * One quiet place where everything Forge has noticed drift on collects, to be
 * reviewed *on your terms*. Design rules, deliberately:
 *   • Calm by default. A reassuring "all caught up" is the resting state.
 *   • No counts shouting from the nav, no red badges — you open it when you
 *     choose to. It informs; it doesn't nag.
 *   • One thing at a time, plain language, one tap to go reconcile.
 *
 * Scans only while open (see useReactiveReview) so it never runs as an
 * anxious background poll.
 */

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { X, Check, RefreshCw, ArrowRight, Loader2 } from "lucide-react";
import { useReactiveReview } from "@/hooks/useReactiveReview";

const ease = [0.22, 0.61, 0.36, 1] as const;

export function CalmReview({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { items, loading, scannedAt } = useReactiveReview(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  const jump = (projectId: string, docId: string) => {
    onClose();
    router.push(`/project/${projectId}/doc/${docId}`);
  };

  const settled = !loading && scannedAt !== null && items.length === 0;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease }}
          className="fixed inset-0 z-50 flex justify-end bg-foreground/30 backdrop-blur-[2px]"
          onClick={onClose}
          aria-modal="true"
          role="dialog"
          aria-label="Calm review"
        >
          <motion.aside
            initial={{ x: 24, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 24, opacity: 0 }}
            transition={{ duration: 0.24, ease }}
            onClick={(e) => e.stopPropagation()}
            className="h-full w-full max-w-[400px] bg-background border-l border-border shadow-[0_0_80px_-20px_rgba(0,0,0,0.5)] flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <div className="flex items-center gap-2.5">
                <span className="text-[11px] uppercase tracking-[0.18em] text-foreground font-semibold">
                  Calm Review
                </span>
                {loading && <Loader2 size={12} className="text-muted animate-spin" />}
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="text-muted hover:text-foreground transition-colors p-1"
              >
                <X size={15} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto">
              {loading && items.length === 0 ? (
                <div className="flex items-center justify-center py-24">
                  <Loader2 size={18} className="text-muted animate-spin" />
                </div>
              ) : settled ? (
                <div className="flex flex-col items-center justify-center text-center px-8 py-24 gap-4">
                  <div className="w-12 h-12 border border-green/30 bg-green/[0.06] flex items-center justify-center">
                    <Check size={20} className="text-green" strokeWidth={2} />
                  </div>
                  <div>
                    <p className="text-[15px] text-foreground font-display font-semibold tracking-[-0.01em]">
                      You&apos;re all caught up
                    </p>
                    <p className="text-[12px] text-muted mt-1.5 leading-relaxed max-w-[260px]">
                      Nothing has drifted. Forge keeps your living sections current — you&apos;ll find anything that needs a look right here.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="px-5 pt-4 pb-2">
                    <p className="text-[12px] text-muted leading-relaxed">
                      {items.length === 1
                        ? "One living section drifted because its source changed. Reconcile it when you're ready."
                        : `${items.length} living sections drifted because their sources changed. Reconcile them when you're ready — no rush.`}
                    </p>
                  </div>
                  <ul className="px-3 pb-4">
                    {items.map((it) => (
                      <li key={`${it.docId}:${it.sectionId}`}>
                        <button
                          type="button"
                          onClick={() => jump(it.projectId, it.docId)}
                          className="group w-full text-left px-3 py-3 flex items-start gap-3 hover:bg-warm/[0.05] transition-colors border-b border-border/40 last:border-b-0"
                        >
                          <span className="mt-1 w-2 h-2 rounded-full bg-warm shrink-0" aria-hidden />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <RefreshCw size={10} className="text-warm shrink-0" strokeWidth={2} />
                              <span className="text-[9px] uppercase tracking-[0.14em] font-bold text-warm">
                                Drifted
                              </span>
                            </div>
                            <p className="text-[13px] text-foreground font-medium leading-snug truncate">
                              {it.rule}
                            </p>
                            <p className="text-[11px] text-muted truncate mt-0.5">
                              in {it.docTitle}
                            </p>
                          </div>
                          <ArrowRight
                            size={13}
                            className="text-muted/50 group-hover:text-warm shrink-0 mt-0.5 transition-colors"
                            strokeWidth={2}
                          />
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-border shrink-0">
              <p className="text-[9.5px] uppercase tracking-[0.14em] text-muted/70 font-medium leading-relaxed">
                Reactivity, on your terms — Forge surfaces drift; you decide when to act.
              </p>
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
