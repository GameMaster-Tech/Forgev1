"use client";

/**
 * EchoTray — the slide-in panel that shows what Echo noticed.
 *
 * Anatomy (right-side panel, 380px on desktop, full width on mobile):
 *
 *   ┌───────────────────────────────────────────┐
 *   │ Echo                            [×]       │
 *   │ Heard X things across your workspace.     │
 *   │  ─────────────────────────────────────    │
 *   │ ▍ HIGH                                    │
 *   │ ┌─────────────────────────────────────┐   │
 *   │ │ Title                               │   │
 *   │ │ Body explaining what's tense.       │   │
 *   │ │ [Jump] [Snooze] [Dismiss]           │   │
 *   │ └─────────────────────────────────────┘   │
 *   │ ▍ MEDIUM …                                │
 *   │                                            │
 *   │ ─ Empty? "All clear. Echo will speak up   │
 *   │   when something needs you."              │
 *   │                                            │
 *   │ Re-check now · last X min ago             │
 *   └───────────────────────────────────────────┘
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import type { EchoAction, EchoNotice, EchoSeverity } from "@/lib/echo/types";
import { useEchoNotices } from "@/hooks/useEchoNotices";
import { useEchoScan } from "@/hooks/useEchoScan";

const EASE = [0.22, 0.61, 0.36, 1] as const;

const SEVERITY_ORDER: EchoSeverity[] = ["high", "medium", "low"];
const SEVERITY_LABEL: Record<EchoSeverity, string> = {
  high: "Look at today",
  medium: "Worth a look this week",
  low: "Housekeeping",
};
const SEVERITY_RING: Record<EchoSeverity, string> = {
  high: "border-rose/40",
  medium: "border-warm/40",
  low: "border-muted/40",
};
const SEVERITY_DOT: Record<EchoSeverity, string> = {
  high: "bg-rose",
  medium: "bg-warm",
  low: "bg-muted",
};

interface EchoTrayProps {
  uid: string | null;
  open: boolean;
  onClose: () => void;
}

export function EchoTray({ uid, open, onClose }: EchoTrayProps) {
  const notices = useEchoNotices(uid);
  const scan = useEchoScan(uid);
  const router = useRouter();

  // Mark every visible notice as seen the moment the tray opens.
  useEffect(() => {
    if (open && notices.unseenCount > 0) {
      void notices.markAllSeen();
    }
  }, [open, notices]);

  const grouped: Record<EchoSeverity, EchoNotice[]> = {
    high: [],
    medium: [],
    low: [],
  };
  for (const n of notices.active) {
    grouped[n.severity].push(n);
  }

  const totalActive = notices.active.length;

  return (
    <AnimatePresence>
      {open ? (
        <>
          {/* Backdrop */}
          <motion.div
            key="echo-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[70] bg-foreground/25 backdrop-blur-[2px]"
            onClick={onClose}
            aria-hidden
          />
          {/* Panel */}
          <motion.aside
            key="echo-panel"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.28, ease: EASE }}
            className="fixed right-0 top-0 bottom-0 z-[80] w-full sm:w-[380px] bg-background border-l border-border shadow-[-20px_0_40px_-20px_rgba(0,0,0,0.25)] flex flex-col"
            role="dialog"
            aria-label="Echo"
          >
            {/* Header */}
            <div className="px-5 pt-5 pb-3 border-b border-border flex items-start gap-3">
              <div className="w-9 h-9 border border-violet/30 bg-violet/[0.06] flex items-center justify-center shrink-0">
                <Wand2 size={14} strokeWidth={2} className="text-violet" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-[0.18em] font-semibold text-violet">
                    Echo
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums">
                    {totalActive === 0
                      ? "all clear"
                      : `${totalActive} active`}
                  </span>
                </div>
                <h2 className="font-display font-bold text-foreground text-[18px] tracking-[-0.018em] leading-tight mt-0.5">
                  {totalActive === 0
                    ? "Nothing needs you right now."
                    : `Heard ${totalActive} thing${totalActive === 1 ? "" : "s"} across your workspace.`}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close Echo"
                className="p-1.5 text-muted hover:text-foreground transition-colors shrink-0"
              >
                <X size={14} strokeWidth={1.75} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {notices.loading ? (
                <div className="flex items-center gap-2 text-[12px] text-muted py-6">
                  <Loader2 size={13} className="animate-spin text-violet" />
                  Loading…
                </div>
              ) : totalActive === 0 ? (
                <EmptyState scanning={scan.scanning} />
              ) : (
                SEVERITY_ORDER.map((sev) => {
                  const items = grouped[sev];
                  if (items.length === 0) return null;
                  return (
                    <section key={sev}>
                      <div className="flex items-center gap-2 mb-2">
                        <span aria-hidden className={`w-1.5 h-1.5 ${SEVERITY_DOT[sev]}`} />
                        <span className="text-[9px] uppercase tracking-[0.18em] font-semibold text-muted">
                          {SEVERITY_LABEL[sev]}
                        </span>
                      </div>
                      <ul className="space-y-2">
                        {items.map((n) => (
                          <NoticeCard
                            key={n.id}
                            notice={n}
                            onAction={async (action) => {
                              await handleAction(
                                action,
                                n,
                                notices,
                                router,
                              );
                            }}
                          />
                        ))}
                      </ul>
                    </section>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-border bg-surface flex items-center justify-between gap-3">
              <span className="text-[10px] uppercase tracking-[0.14em] text-muted font-medium tabular-nums">
                {scan.lastScannedAt
                  ? `Last checked ${relTime(scan.lastScannedAt)}`
                  : "Not checked yet"}
                {scan.error ? (
                  <span className="text-rose ml-2">· {scan.error}</span>
                ) : null}
              </span>
              <button
                type="button"
                onClick={() => void scan.scan({ force: true })}
                disabled={scan.scanning}
                className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] font-semibold text-violet hover:text-foreground transition-colors disabled:opacity-50"
              >
                {scan.scanning ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <RefreshCw size={11} strokeWidth={2} />
                )}
                {scan.scanning ? "Listening…" : "Re-check"}
              </button>
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}

/* ─────────────────────────── notice card ─────────────────────────── */

function NoticeCard({
  notice,
  onAction,
}: {
  notice: EchoNotice;
  onAction: (action: EchoAction) => void | Promise<void>;
}) {
  const isUnseen = !notice.seen;
  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.22, ease: EASE }}
      className={`border ${SEVERITY_RING[notice.severity]} bg-surface px-4 py-3 relative`}
    >
      {isUnseen ? (
        <span
          aria-hidden
          className="absolute left-0 top-3 bottom-3 w-[2px] bg-violet"
        />
      ) : null}
      <h3 className="font-display font-bold text-foreground text-[14px] tracking-[-0.012em] leading-snug mb-1 pr-2">
        {notice.title}
      </h3>
      <p className="text-[12.5px] text-muted leading-relaxed mb-2">
        {notice.body}
      </p>
      <div className="flex items-center gap-1 flex-wrap">
        {notice.actions.map((a, i) => (
          <button
            key={`${a.kind}-${i}`}
            type="button"
            onClick={() => void onAction(a)}
            className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] font-semibold px-2 py-1 border transition-colors ${
              a.kind === "dismiss"
                ? "border-border text-muted hover:text-foreground hover:border-foreground/30"
                : a.kind === "snooze"
                  ? "border-border text-muted hover:text-foreground hover:border-foreground/30"
                  : a.kind === "mark_done"
                    ? "border-green/40 text-green hover:bg-green/[0.06]"
                    : "border-violet/40 text-violet hover:bg-violet/[0.06]"
            }`}
          >
            {a.label}
            {a.kind === "jump_doc" || a.kind === "jump_event" ? (
              <ArrowRight size={9} strokeWidth={2} />
            ) : null}
          </button>
        ))}
      </div>
    </motion.li>
  );
}

/* ─────────────────────────── empty state ─────────────────────────── */

function EmptyState({ scanning }: { scanning: boolean }) {
  return (
    <div className="flex flex-col items-center text-center pt-10 px-2">
      <div className="w-12 h-12 border border-green/30 bg-green/[0.04] flex items-center justify-center mb-3">
        <CheckCircle2 size={18} strokeWidth={2} className="text-green" />
      </div>
      <p className="font-display font-bold text-foreground text-[16px] tracking-[-0.014em] mb-1">
        All clear.
      </p>
      <p className="text-[12px] text-muted leading-relaxed max-w-xs">
        {scanning
          ? "Echo is listening — give it a moment."
          : "Echo will speak up the moment something across your docs, calendar, or goals stops adding up."}
      </p>
    </div>
  );
}

/* ─────────────────────────── action dispatcher ─────────────────────────── */

async function handleAction(
  action: EchoAction,
  notice: EchoNotice,
  notices: ReturnType<typeof useEchoNotices>,
  router: ReturnType<typeof useRouter>,
): Promise<void> {
  switch (action.kind) {
    case "jump_doc": {
      const docId =
        (action.payload?.docId as string | undefined) ??
        notice.sourceRefs.find((r) => r.kind === "doc")?.id;
      const projectId =
        (action.payload?.projectId as string | undefined) ??
        notice.sourceRefs.find((r) => r.kind === "doc")?.projectId ??
        notice.projectId ??
        null;
      if (docId && projectId) {
        router.push(`/project/${projectId}/doc/${docId}`);
      } else if (docId) {
        // Fallback — open the project's first surface; the doc id is
        // still preserved in the URL hash so a future router can
        // resolve it.
        router.push(`/projects#doc-${docId}`);
      }
      return;
    }
    case "jump_event": {
      router.push("/calendar");
      return;
    }
    case "snooze": {
      const hours = (action.payload?.hours as number | undefined) ?? 24;
      await notices.snooze(notice.id, hours);
      return;
    }
    case "dismiss": {
      await notices.dismiss(notice.id);
      return;
    }
    case "mark_done": {
      await notices.markDone(notice.id);
      return;
    }
  }
}

/* ─────────────────────────── helpers ─────────────────────────── */

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

/** Sparkles is exported here so the bell trigger can re-use the same
 * lucide instance without re-importing it everywhere. */
export const ECHO_ICON = Sparkles;
/* Keep AlertTriangle exported so the bell can pulse on high-severity. */
export const ECHO_ALERT = AlertTriangle;
