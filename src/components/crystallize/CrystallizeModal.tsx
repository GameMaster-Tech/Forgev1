"use client";

/**
 * CrystallizeModal — picker + result view for cross-doc synthesis.
 *
 * Two stages in one component (mirrors a wizard):
 *
 *   1. PICK    — list of project docs with a checkbox. The user
 *                selects 2–5; the action button stays disabled
 *                outside that range. Most-recent docs at top.
 *
 *   2. RESULT  — animated card with the thesis, support quotes,
 *                counters, open questions, and "what to write
 *                next". Footer offers "Save as new doc" (drops the
 *                synthesis into the same project and navigates) or
 *                "Run again" to go back to PICK.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  FileText,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import type { FirestoreDocument } from "@/lib/firebase/firestore";
import { useCrystallize } from "@/hooks/useCrystallize";
import { useFocusTrap } from "@/hooks/useFocusTrap";

const EASE = [0.22, 0.61, 0.36, 1] as const;
const MIN = 2;
const MAX = 5;

interface CrystallizeModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  docs: FirestoreDocument[];
}

export function CrystallizeModal({ open, onClose, projectId, docs }: CrystallizeModalProps) {
  const router = useRouter();
  const { running, result, error, run, clear, saveAsNewDoc } = useCrystallize();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const panelRef = useFocusTrap<HTMLDivElement>({ active: open, onClose });

  // Reset when opening fresh.
  useEffect(() => {
    if (open) {
      setSelected(new Set());
      clear();
    }
  }, [open, clear]);

  const orderedDocs = useMemo(
    () => [...docs].sort((a, b) => (b.wordCount ?? 0) - (a.wordCount ?? 0)),
    [docs],
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX) next.add(id);
      return next;
    });
  };

  const goRun = async () => {
    if (selected.size < MIN || selected.size > MAX) return;
    await run({ projectId, docIds: Array.from(selected) });
  };

  const handleSave = async () => {
    setSaving(true);
    const newId = await saveAsNewDoc(projectId);
    setSaving(false);
    if (newId) {
      onClose();
      router.push(`/project/${projectId}/doc/${newId}`);
    }
  };

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[70] bg-foreground/30 backdrop-blur-[2px]"
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            key="panel"
            ref={panelRef}
            initial={{ opacity: 0, y: 12, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.985 }}
            transition={{ duration: 0.24, ease: EASE }}
            role="dialog"
            aria-modal="true"
            aria-label="Crystallize documents"
            className="fixed inset-0 z-[80] flex items-start justify-center p-6 sm:p-10 overflow-y-auto pointer-events-none"
          >
            <div className="pointer-events-auto w-full max-w-2xl bg-background border border-border shadow-[0_28px_64px_-24px_rgba(0,0,0,0.4)] mt-12 mb-12">
              {/* Header */}
              <div className="flex items-start gap-3 px-5 py-4 border-b border-border">
                <div className="w-9 h-9 border border-violet/30 bg-violet/[0.06] flex items-center justify-center shrink-0">
                  <Sparkles size={14} strokeWidth={2} className="text-violet" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-violet">
                    Crystallize
                  </div>
                  <h2 className="font-display font-bold text-[18px] tracking-[-0.018em] leading-snug mt-0.5">
                    {result
                      ? "Synthesis ready."
                      : `Pick ${MIN}–${MAX} docs. Forge will find the thesis.`}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="p-1.5 text-muted hover:text-foreground transition-colors shrink-0"
                >
                  <X size={14} strokeWidth={1.75} />
                </button>
              </div>

              {/* Body */}
              {result ? (
                <ResultView result={result} />
              ) : (
                <PickList
                  docs={orderedDocs}
                  selected={selected}
                  onToggle={toggle}
                  disabled={running}
                />
              )}

              {/* Error */}
              {error ? (
                <div className="px-5 py-2.5 border-t border-rose/30 bg-rose/[0.04] text-[12px] text-rose">
                  {error}
                </div>
              ) : null}

              {/* Footer */}
              <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-border bg-surface/40">
                {result ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        clear();
                      }}
                      disabled={saving}
                      className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] font-semibold text-muted hover:text-foreground transition-colors disabled:opacity-50"
                    >
                      <ChevronLeft size={11} strokeWidth={2} />
                      Run again
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSave()}
                      disabled={saving}
                      className="inline-flex items-center gap-1.5 bg-violet text-white hover:bg-violet/90 disabled:opacity-50 text-[10px] uppercase tracking-[0.14em] font-bold px-3 py-1.5 transition-colors"
                    >
                      {saving ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <ArrowRight size={11} strokeWidth={2.25} />
                      )}
                      {saving ? "Saving…" : "Save as new doc"}
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-[10px] uppercase tracking-[0.14em] text-muted font-medium tabular-nums">
                      {selected.size}/{MAX} selected
                    </span>
                    <button
                      type="button"
                      onClick={() => void goRun()}
                      disabled={selected.size < MIN || selected.size > MAX || running}
                      className="inline-flex items-center gap-1.5 bg-violet text-white hover:bg-violet/90 disabled:opacity-50 text-[10px] uppercase tracking-[0.14em] font-bold px-3 py-1.5 transition-colors"
                    >
                      {running ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <Sparkles size={11} strokeWidth={2.25} />
                      )}
                      {running ? "Crystallizing…" : "Crystallize"}
                    </button>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}

/* ─────────────────────── pick list ─────────────────────── */

function PickList({
  docs,
  selected,
  onToggle,
  disabled,
}: {
  docs: FirestoreDocument[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  disabled: boolean;
}) {
  if (docs.length === 0) {
    return (
      <div className="px-5 py-10 text-center text-[12px] text-muted">
        This project has no documents yet. Create at least 2 to crystallize.
      </div>
    );
  }
  return (
    <ul className="max-h-[420px] overflow-y-auto divide-y divide-border">
      {docs.map((d) => {
        const checked = selected.has(d.id);
        const wc = d.wordCount ?? 0;
        return (
          <li key={d.id}>
            <label
              className={`flex items-center gap-3 px-5 py-3 cursor-pointer transition-colors ${
                checked ? "bg-violet/[0.05]" : "hover:bg-foreground/[0.03]"
              } ${disabled ? "opacity-50 pointer-events-none" : ""}`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(d.id)}
                className="accent-violet h-3.5 w-3.5"
              />
              <FileText
                size={13}
                strokeWidth={1.75}
                className={checked ? "text-violet" : "text-muted"}
              />
              <span className="text-[13px] text-foreground flex-1 truncate">
                {d.title}
              </span>
              <span className="text-[10px] text-muted tabular-nums">
                {wc.toLocaleString()} w
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

/* ─────────────────────── result view ─────────────────────── */

function ResultView({ result }: { result: ReturnType<typeof useCrystallize>["result"] }) {
  if (!result) return null;
  return (
    <div className="max-h-[60vh] overflow-y-auto px-5 py-4 space-y-4">
      <div>
        <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-violet mb-1">
          Thesis
        </div>
        <p className="text-[14px] text-foreground leading-relaxed">{result.thesis}</p>
      </div>

      {result.support.length > 0 ? (
        <Section title="What the docs argue">
          {result.support.map((s, i) => (
            <Quote key={`s-${i}`} why={s.why} span={s.span} accent="text-green" />
          ))}
        </Section>
      ) : null}

      {result.counters.length > 0 ? (
        <Section title="What complicates it">
          {result.counters.map((s, i) => (
            <Quote key={`c-${i}`} why={s.why} span={s.span} accent="text-rose" />
          ))}
        </Section>
      ) : null}

      {result.openQuestions.length > 0 ? (
        <Section title="Still open">
          <ul className="space-y-1.5 text-[12.5px] text-foreground/85 leading-relaxed list-disc pl-5 marker:text-muted">
            {result.openQuestions.map((q, i) => (
              <li key={`q-${i}`}>{q}</li>
            ))}
          </ul>
        </Section>
      ) : null}

      {result.whatToWriteNext ? (
        <Section title="Write this next">
          <p className="text-[12.5px] text-foreground/90 leading-relaxed flex items-start gap-2">
            <CheckCircle2
              size={13}
              strokeWidth={2}
              className="text-violet shrink-0 mt-0.5"
            />
            {result.whatToWriteNext}
          </p>
        </Section>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-muted mb-2">
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Quote({ why, span, accent }: { why: string; span: string; accent: string }) {
  return (
    <div className="border-l-2 border-border pl-3">
      <p className={`text-[12px] ${accent} font-medium mb-0.5`}>{why}</p>
      <p className="text-[12.5px] text-foreground/85 italic leading-snug">
        &ldquo;{span}&rdquo;
      </p>
    </div>
  );
}
