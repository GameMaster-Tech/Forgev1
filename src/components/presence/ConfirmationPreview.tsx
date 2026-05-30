"use client";

/**
 * ConfirmationPreview — replaces blocking modals with a calm, non-blocking
 * preview for actions that warrant a check (esp. destructive ones). Shows the
 * risk level, affected entities, estimated impact, and undo availability, with
 * inline Confirm / Cancel, Y/N keys, and auto-dismiss.
 *
 * Store-driven: it renders the pending `confirmation` and resolves it via the
 * store. Features run the real action by listening for the `confirm.resolve`
 * event (see PresenceLayer / docs) — keeping this component pure + serialisable
 * for a WebSocket transport.
 */

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, RotateCcw, X } from "lucide-react";
import { usePresenceStore } from "@/store/presence";
import { RISK_META } from "@/lib/presence/types";

const ease = [0.22, 0.61, 0.36, 1] as const;

export function ConfirmationPreview() {
  const confirmation = usePresenceStore((s) => s.confirmation);
  const resolve = usePresenceStore((s) => s.resolveConfirmation);

  const id = confirmation?.id;
  const autoDismissMs = confirmation?.autoDismissMs ?? 0;

  // Auto-dismiss (treat as "not now").
  useEffect(() => {
    if (!id || !autoDismissMs) return;
    const t = window.setTimeout(() => resolve(id, "dismiss"), autoDismissMs);
    return () => window.clearTimeout(t);
  }, [id, autoDismissMs, resolve]);

  // Y / N keyboard (also the hook point for voice "yes"/"no").
  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "y" || e.key === "Enter") {
        e.preventDefault();
        resolve(id, "confirm");
      } else if (e.key.toLowerCase() === "n" || e.key === "Escape") {
        e.preventDefault();
        resolve(id, "cancel");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id, resolve]);

  const risk = confirmation ? RISK_META[confirmation.risk] : null;

  return (
    <AnimatePresence>
      {confirmation && risk && (
        <motion.div
          initial={{ opacity: 0, y: -10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.98 }}
          transition={{ duration: 0.2, ease }}
          role="alertdialog"
          aria-label={`Confirm: ${confirmation.summary}`}
          className={`fixed top-5 left-1/2 -translate-x-1/2 z-[80] w-[min(420px,calc(100vw-2rem))] bg-background border ${risk.ring} rounded-[var(--radius)] shadow-[0_24px_60px_-20px_rgba(0,0,0,0.5)] overflow-hidden`}
        >
          <div className="flex items-start gap-3 px-4 pt-3.5 pb-3">
            <div className={`w-8 h-8 rounded-[6px] border ${risk.ring} flex items-center justify-center shrink-0`}>
              <AlertTriangle size={15} className={risk.tone} strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={`text-[9px] uppercase tracking-[0.16em] font-bold ${risk.tone}`}>
                  {risk.label} risk
                </span>
                {confirmation.undoable && (
                  <span className="flex items-center gap-1 text-[9px] uppercase tracking-[0.12em] text-muted font-medium">
                    <RotateCcw size={9} /> undoable
                  </span>
                )}
              </div>
              <p className="text-[13.5px] text-foreground font-medium leading-snug mt-1">
                {confirmation.summary}
              </p>
              {confirmation.impact && (
                <p className="text-[11px] text-muted mt-1 leading-relaxed">{confirmation.impact}</p>
              )}

              {confirmation.affected.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {confirmation.affected.slice(0, 6).map((e) => (
                    <li
                      key={e.id}
                      className="text-[10px] text-foreground/80 border border-border rounded-[5px] px-1.5 py-0.5 bg-surface"
                    >
                      {e.label}
                    </li>
                  ))}
                  {confirmation.affected.length > 6 && (
                    <li className="text-[10px] text-muted px-1 py-0.5">
                      +{confirmation.affected.length - 6} more
                    </li>
                  )}
                </ul>
              )}
            </div>
            <button
              onClick={() => resolve(confirmation.id, "dismiss")}
              aria-label="Dismiss"
              className="text-muted hover:text-foreground transition-colors p-1 shrink-0"
            >
              <X size={14} />
            </button>
          </div>

          <div className="flex items-center gap-2 px-4 py-2.5 border-t border-border/60 bg-surface/50">
            <button
              onClick={() => resolve(confirmation.id, "confirm")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] font-bold text-white bg-violet hover:bg-violet/90 rounded-[6px] transition-colors"
            >
              <Check size={12} strokeWidth={2.5} /> Confirm
            </button>
            <button
              onClick={() => resolve(confirmation.id, "cancel")}
              className="px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] font-semibold text-muted hover:text-foreground border border-border rounded-[6px] transition-colors"
            >
              Cancel
            </button>
            <span className="ml-auto text-[9px] uppercase tracking-[0.14em] text-muted/70 font-mono">
              Y / N
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
