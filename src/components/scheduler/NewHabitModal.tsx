"use client";

/**
 * NewHabitModal — create a recurring habit on the active project.
 *
 * Writes through `upsertHabit` to
 * /users/{uid}/projects/{pid}/scheduler_habits. The Scheduler workspace
 * subscription picks it up and the Habits page rerenders.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import { X, Loader2, Plus } from "lucide-react";
import type { Habit, Energy } from "@/lib/scheduler/types";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { upsertHabit } from "@/lib/firestore/scheduler";

const ease = [0.22, 0.61, 0.36, 1] as const;

interface NewHabitModalProps {
  uid: string;
  projectId: string;
  onClose: () => void;
  onCreated?: (habit: Habit) => void;
}

const CADENCE_OPTIONS: { value: string; label: string; rrule: string }[] = [
  { value: "daily",   label: "Daily",                 rrule: "FREQ=DAILY" },
  { value: "weekdays",label: "Weekdays",              rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" },
  { value: "mwf",     label: "Mon · Wed · Fri",       rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR" },
  { value: "ttsa",    label: "Tue · Thu · Sat",       rrule: "FREQ=WEEKLY;BYDAY=TU,TH,SA" },
  { value: "weekly",  label: "Once a week",           rrule: "FREQ=WEEKLY" },
];

const ENERGY_OPTIONS: { value: Energy; label: string }[] = [
  { value: "deep",     label: "Deep focus" },
  { value: "shallow",  label: "Light admin" },
  { value: "creative", label: "Creative" },
  { value: "social",   label: "Social" },
  { value: "rest",     label: "Rest / recovery" },
];

export function NewHabitModal({
  uid,
  projectId,
  onClose,
  onCreated,
}: NewHabitModalProps) {
  const [title, setTitle] = useState("");
  const [cadence, setCadence] = useState("daily");
  const [duration, setDuration] = useState(30);
  const [energy, setEnergy] = useState<Energy>("deep");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trapRef = useFocusTrap<HTMLDivElement>({ active: true, onClose });

  const submit = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const now = Date.now();
      const rrule =
        CADENCE_OPTIONS.find((c) => c.value === cadence)?.rrule ?? "FREQ=DAILY";
      const habit: Habit = {
        id: `h_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        projectId,
        ownerId: uid,
        title: title.trim(),
        rrule,
        durationMinutes: Math.max(5, Math.round(duration)),
        energy,
        timeZone:
          typeof Intl !== "undefined"
            ? Intl.DateTimeFormat().resolvedOptions().timeZone
            : "UTC",
        streak: 0,
        createdAt: now,
      };
      await upsertHabit({ uid, projectId }, habit);
      onCreated?.(habit);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the habit.");
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
        aria-labelledby="new-habit-title"
        initial={{ y: 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 12, opacity: 0 }}
        transition={{ duration: 0.22, ease }}
        onClick={(e) => e.stopPropagation()}
        className="bg-background border border-border w-full max-w-md shadow-[0_30px_80px_-20px_rgba(0,0,0,0.4)]"
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <span
            id="new-habit-title"
            className="text-[10px] uppercase tracking-[0.18em] text-muted font-semibold"
          >
            New habit
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
            placeholder="e.g. Read 30 minutes"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            className="w-full font-display font-bold text-[20px] tracking-[-0.02em] bg-transparent border-b border-border focus:border-violet outline-none py-1 placeholder:text-muted"
          />

          <Field label="How often">
            <select
              value={cadence}
              onChange={(e) => setCadence(e.target.value)}
              className="w-full border border-border bg-background px-2 py-1.5 text-[13px] focus:border-violet/50 outline-none"
            >
              {CADENCE_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Duration (min)">
              <input
                type="number"
                min={5}
                step={5}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="w-full border border-border bg-background px-2 py-1.5 text-[13px] tabular-nums focus:border-violet/50 outline-none"
              />
            </Field>
            <Field label="Energy">
              <select
                value={energy}
                onChange={(e) => setEnergy(e.target.value as Energy)}
                className="w-full border border-border bg-background px-2 py-1.5 text-[13px] focus:border-violet/50 outline-none"
              >
                {ENERGY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

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
            Create habit
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
