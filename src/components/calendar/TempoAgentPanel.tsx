"use client";

/**
 * TempoAgentPanel — the user-facing surface for the Groq-powered
 * Tempo scheduler.
 *
 * Three states:
 *   • Idle      — single textarea + "Plan" button + horizon picker.
 *   • Running   — animated thinking strip; live "steps" list as the
 *                 agent calls tools.
 *   • Result    — a structured diff view: every proposed change as a
 *                 card (kind chip, title, time, rationale) plus the
 *                 narrative summary, unresolved questions, and an
 *                 "Apply" / "Discard" footer.
 *
 * Apply is currently routed through the same /api/tempo/agent endpoint
 * with `previewOnly: false`, which lets the model actually mutate the
 * calendar. Discard simply clears the panel.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  Brain,
  Calendar as CalendarIcon,
  CheckCircle2,
  Clock,
  Loader2,
  Send,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { useTempoAgent, type TempoPlan } from "@/hooks/useTempoAgent";

const EASE = [0.22, 0.61, 0.36, 1] as const;

const HORIZONS = [
  { value: 3, label: "3d" },
  { value: 7, label: "7d" },
  { value: 14, label: "14d" },
  { value: 30, label: "30d" },
] as const;

const KIND_ACCENT: Record<TempoPlan["changes"][number]["kind"], { ring: string; pill: string }> = {
  create: { ring: "border-green/40 text-green", pill: "bg-green/[0.06]" },
  update: { ring: "border-cyan/40 text-cyan", pill: "bg-cyan/[0.06]" },
  delete: { ring: "border-rose/40 text-rose", pill: "bg-rose/[0.06]" },
};

interface TempoAgentPanelProps {
  projectId: string | null;
}

export function TempoAgentPanel({ projectId }: TempoAgentPanelProps) {
  const { response, running, error, plan, clear } = useTempoAgent(projectId);

  const [intent, setIntent] = useState("");
  const [horizonDays, setHorizonDays] = useState<number>(7);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  const handlePlan = async () => {
    setApplied(false);
    await plan({ intent, horizonDays, previewOnly: true });
  };

  const handleApply = async () => {
    if (!intent) return;
    setApplying(true);
    try {
      await plan({ intent, horizonDays, previewOnly: false });
      setApplied(true);
    } finally {
      setApplying(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE }}
      className="border border-border bg-surface relative overflow-hidden"
    >
      <span aria-hidden className="absolute left-0 top-5 bottom-5 w-[2px] bg-violet" />

      {/* Header */}
      <div className="flex items-start gap-4 px-5 py-4 border-b border-border">
        <div className="w-9 h-9 border border-violet/30 bg-violet/[0.06] flex items-center justify-center shrink-0">
          <Wand2 size={14} strokeWidth={2} className="text-violet" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-[0.18em] text-violet font-semibold">
            Ask Tempo
          </div>
          <h3 className="font-display font-bold text-foreground text-[18px] tracking-[-0.018em] leading-snug mt-0.5">
            Plan in plain English.
          </h3>
          <p className="text-[12.5px] text-muted leading-relaxed mt-1">
            Tell Tempo what you want — &ldquo;block deep work mornings,&rdquo;
            &ldquo;move every meeting to Tuesdays,&rdquo; &ldquo;clear my Friday for
            the launch.&rdquo; It reads your calendar, drafts a plan, and shows
            you exactly what will change before applying.
          </p>
        </div>
      </div>

      {/* Input + horizon */}
      <div className="px-5 py-4 border-b border-border">
        <textarea
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          placeholder="e.g. plan my week around the product launch on Thursday — protect 4 hours of deep work each morning"
          rows={3}
          className="w-full bg-background border border-border focus:border-violet/60 focus:outline-none px-3 py-2.5 text-[13px] leading-relaxed text-foreground placeholder:text-muted/60 resize-none transition-colors"
          disabled={running || applying}
        />
        <div className="flex items-center justify-between mt-3 gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] uppercase tracking-[0.16em] text-muted font-medium mr-1">
              Horizon
            </span>
            {HORIZONS.map((h) => (
              <button
                key={h.value}
                type="button"
                onClick={() => setHorizonDays(h.value)}
                disabled={running || applying}
                className={`px-2 py-1 text-[10px] uppercase tracking-[0.12em] font-bold border transition-colors ${
                  horizonDays === h.value
                    ? "text-white bg-violet border-violet"
                    : "text-muted border-border hover:border-violet/40 hover:text-foreground"
                } disabled:opacity-50`}
              >
                {h.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void handlePlan()}
            disabled={running || applying || !intent.trim() || !projectId}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 text-[11px] uppercase tracking-[0.14em] font-bold text-white bg-violet hover:bg-violet/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {running ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Send size={12} strokeWidth={2.25} />
            )}
            {running ? "Planning…" : "Draft a plan"}
          </button>
        </div>
      </div>

      {/* Body */}
      <AnimatePresence mode="wait">
        {running ? (
          <motion.div
            key="running"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="px-5 py-5"
          >
            <div className="flex items-center gap-3 text-[12px] text-muted mb-3">
              <Loader2 size={14} className="text-violet animate-spin" />
              The agent is reading your calendar and drafting…
            </div>
            <ThinkingStrip />
          </motion.div>
        ) : error ? (
          <motion.div
            key="error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="px-5 py-4 text-[12px] text-rose flex items-start gap-2"
          >
            <AlertTriangle size={13} strokeWidth={2} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </motion.div>
        ) : response ? (
          <motion.div
            key="result"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <ResultBody response={response} applied={applied} />
            {response.plan && response.plan.changes.length > 0 ? (
              <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-background/40">
                <button
                  type="button"
                  onClick={() => {
                    clear();
                    setApplied(false);
                  }}
                  disabled={applying}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] font-semibold border border-border text-muted hover:text-foreground hover:border-foreground/40 transition-colors disabled:opacity-50"
                >
                  <X size={11} strokeWidth={2} />
                  Discard
                </button>
                {applied ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] font-bold text-green border border-green/40">
                    <CheckCircle2 size={11} strokeWidth={2} />
                    Applied
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleApply()}
                    disabled={applying || !response.plan}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[10px] uppercase tracking-[0.14em] font-bold text-white bg-violet hover:bg-violet/90 disabled:opacity-50 transition-colors"
                  >
                    {applying ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <Sparkles size={11} strokeWidth={2.25} />
                    )}
                    {applying ? "Applying…" : "Apply changes"}
                  </button>
                )}
              </div>
            ) : null}
          </motion.div>
        ) : (
          <motion.div
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="px-5 py-5 text-[12px] text-muted leading-relaxed"
          >
            <div className="flex items-start gap-2.5">
              <Brain size={13} strokeWidth={2} className="text-violet shrink-0 mt-0.5" />
              <span>
                The agent will call <code className="font-mono text-foreground">calendar_list_events</code>,
                <code className="font-mono text-foreground"> tasks_list</code>, and
                <code className="font-mono text-foreground"> docs_list</code> before
                proposing anything — so nothing it suggests collides with what&apos;s already on
                your week.
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ─────────────────────────── result body ─────────────────────────── */

function ResultBody({
  response,
  applied,
}: {
  response: NonNullable<ReturnType<typeof useTempoAgent>["response"]>;
  applied: boolean;
}) {
  const plan = response.plan;
  return (
    <div>
      {plan?.summary ? (
        <div className="px-5 pt-4 pb-2">
          <div className="flex items-center gap-2 mb-1.5">
            <Sparkles size={11} strokeWidth={2} className="text-violet" />
            <span className="text-[9px] uppercase tracking-[0.18em] font-semibold text-violet">
              Plan summary
            </span>
          </div>
          <p className="text-[13px] text-foreground/90 leading-relaxed">{plan.summary}</p>
        </div>
      ) : null}

      {/* Steps tape */}
      {response.steps.length > 0 ? (
        <div className="px-5 pt-3">
          <div className="flex items-center gap-2 flex-wrap text-[10px] text-muted">
            <span className="uppercase tracking-[0.16em] font-medium mr-1">Used</span>
            {response.steps.map((s, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 border border-border bg-background/60 font-mono"
                title={`${s.durationMs}ms`}
              >
                {s.tool}
              </span>
            ))}
            <span className="ml-auto text-muted/70 tabular-nums">
              {response.tokens.total} tokens · {Math.round(response.durationMs / 100) / 10}s
              {applied ? " · live" : " · preview"}
            </span>
          </div>
        </div>
      ) : null}

      {/* Changes */}
      {plan && plan.changes.length > 0 ? (
        <ul className="px-5 pt-4 pb-2 space-y-2">
          {plan.changes.map((c, i) => (
            <ChangeCard key={i} change={c} order={i} />
          ))}
        </ul>
      ) : (
        <div className="px-5 py-4 text-[12px] text-muted">
          The agent finished without proposing any changes.
        </div>
      )}

      {/* Unresolved */}
      {plan?.unresolved && plan.unresolved.length > 0 ? (
        <div className="mx-5 mb-3 mt-1 border border-warm/30 bg-warm/[0.04] px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-1.5">
            <AlertTriangle size={11} strokeWidth={2} className="text-warm" />
            <span className="text-[9px] uppercase tracking-[0.16em] font-semibold text-warm">
              Needs your input
            </span>
          </div>
          <ul className="space-y-1">
            {plan.unresolved.map((u, i) => (
              <li key={i} className="text-[12px] text-foreground/85 leading-snug">
                • {u}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ChangeCard({
  change,
  order,
}: {
  change: TempoPlan["changes"][number];
  order: number;
}) {
  const accent = KIND_ACCENT[change.kind];
  return (
    <motion.li
      initial={{ opacity: 0, y: 3 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: order * 0.04, ease: EASE }}
      className={`border ${accent.ring.replace("text-", "border-")} ${accent.pill} px-3 py-2.5`}
    >
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <span
          className={`text-[9px] uppercase tracking-[0.16em] font-bold px-1.5 py-0.5 border ${accent.ring}`}
        >
          {change.kind}
        </span>
        <span className="text-[10px] uppercase tracking-[0.14em] text-muted font-medium">
          {change.entity}
        </span>
        {change.start ? (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted tabular-nums">
            <Clock size={9} strokeWidth={2} />
            {formatRange(change.start, change.end)}
          </span>
        ) : null}
      </div>
      <div className="text-[13.5px] font-semibold text-foreground leading-snug mb-0.5 flex items-center gap-1.5">
        <CalendarIcon size={11} strokeWidth={2} className="text-muted shrink-0" />
        {change.title}
      </div>
      {change.rationale ? (
        <p className="text-[11.5px] text-muted leading-relaxed">{change.rationale}</p>
      ) : null}
    </motion.li>
  );
}

function formatRange(start: string, end?: string): string {
  try {
    const s = new Date(start);
    const dayStr = s.toLocaleDateString([], { month: "short", day: "numeric" });
    const sTime = s.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (!end) return `${dayStr} · ${sTime}`;
    const e = new Date(end);
    const eTime = e.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return `${dayStr} · ${sTime}–${eTime}`;
  } catch {
    return start;
  }
}

/* ─────────────────────────── thinking strip ─────────────────────────── */

function ThinkingStrip() {
  return (
    <div className="relative h-1 w-full overflow-hidden bg-violet/10">
      <motion.div
        className="absolute inset-y-0 left-0 w-1/3 bg-violet"
        animate={{ x: ["-100%", "300%"] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}
