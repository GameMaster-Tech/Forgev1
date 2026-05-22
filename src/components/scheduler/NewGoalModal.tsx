"use client";

/**
 * NewGoalModal — create a long-running goal on the active project.
 *
 * Persists to /users/{uid}/projects/{pid}/scheduler_goals via the
 * scheduler service. The page subscribes via useSchedulerWorkspace
 * and rerenders automatically.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import { X, Loader2, Plus } from "lucide-react";
import type { Goal } from "@/lib/scheduler/types";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { upsertGoal } from "@/lib/firestore/scheduler";

const ease = [0.22, 0.61, 0.36, 1] as const;

interface NewGoalModalProps {
  uid: string;
  projectId: string;
  onClose: () => void;
  onCreated?: (goal: Goal) => void;
}

function toLocalDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function NewGoalModal({
  uid,
  projectId,
  onClose,
  onCreated,
}: NewGoalModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [successCriteria, setSuccessCriteria] = useState("");
  const [weeklyHours, setWeeklyHours] = useState(4);
  const [targetDate, setTargetDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trapRef = useFocusTrap<HTMLDivElement>({ active: true, onClose });

  const submit = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const now = Date.now();
      const goal: Goal = {
        id: `g_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        projectId,
        ownerId: uid,
        title: title.trim(),
        description: description.trim() || undefined,
        successCriteria: successCriteria.trim() || undefined,
        targetDate: targetDate
          ? new Date(targetDate).toISOString()
          : undefined,
        weeklyMinutesTarget: Math.max(0, Math.round(weeklyHours * 60)),
        loggedMinutes: 0,
        status: "active",
        createdAt: now,
      };
      await upsertGoal({ uid, projectId }, goal);
      onCreated?.(goal);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the goal.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-foreground/30 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-goal-title"
        initial={{ y: 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 12, opacity: 0 }}
        transition={{ duration: 0.22, ease }}
        onClick={(e) => e.stopPropagation()}
        className="bg-background border border-border w-full max-w-md shadow-[0_30px_80px_-20px_rgba(0,0,0,0.4)]"
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <span
            id="new-goal-title"
            className="text-[10px] uppercase tracking-[0.18em] text-muted font-semibold"
          >
            New goal
          </span>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center text-muted hover:text-foreground"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Submit Q3 grant application"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            className="w-full font-display font-bold text-[20px] tracking-[-0.02em] bg-transparent border-b border-border focus:border-violet outline-none py-1 placeholder:text-muted"
          />

          <Field label="What does done look like? (optional)">
            <input
              value={successCriteria}
              onChange={(e) => setSuccessCriteria(e.target.value)}
              placeholder="One sentence that means you're finished"
              className="w-full border border-border bg-background px-2 py-1.5 text-[13px] focus:border-violet/50 outline-none"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Hours per week">
              <input
                type="number"
                min={0}
                step={0.5}
                value={weeklyHours}
                onChange={(e) => setWeeklyHours(Number(e.target.value))}
                className="w-full border border-border bg-background px-2 py-1.5 text-[13px] tabular-nums focus:border-violet/50 outline-none"
              />
            </Field>
            <Field label="Target date (optional)">
              <input
                type="date"
                value={targetDate}
                min={toLocalDateInput(new Date())}
                onChange={(e) => setTargetDate(e.target.value)}
                className="w-full border border-border bg-background px-2 py-1.5 text-[13px] focus:border-violet/50 outline-none"
              />
            </Field>
          </div>

          <Field label="Notes (optional)">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Context, constraints, scope notes…"
              rows={3}
              className="w-full border border-border bg-background px-2 py-1.5 text-[13px] focus:border-violet/50 outline-none resize-none leading-relaxed"
            />
          </Field>

          {error ? (
            <p className="text-[11.5px] text-rose leading-relaxed">{error}</p>
          ) : null}
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="text-[11px] uppercase tracking-[0.12em] font-semibold text-muted hover:text-foreground px-3 py-2 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!title.trim() || saving}
            className="inline-flex items-center gap-1.5 bg-violet text-white hover:bg-violet/90 disabled:opacity-60 text-[11px] font-semibold uppercase tracking-[0.12em] px-4 py-2 transition-colors"
          >
            {saving ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <Plus size={11} strokeWidth={2.25} />
            )}
            Create goal
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[9px] uppercase tracking-[0.16em] font-medium text-muted block mb-1.5">
        {label}
      </span>
      {children}
    </label>
  );
}
