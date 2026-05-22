"use client";

/**
 * NewTaskModal — create a scheduler Task on the active project.
 *
 * Tasks are work that needs N minutes done by some deadline. Tempo
 * places them inside focus blocks automatically; the user only has
 * to provide title, duration, optional due date, and energy.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import { X, Loader2, Plus } from "lucide-react";
import type { Energy, Task } from "@/lib/scheduler/types";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { upsertTask } from "@/lib/firestore/scheduler";

const ease = [0.22, 0.61, 0.36, 1] as const;

interface NewTaskModalProps {
  uid: string;
  projectId: string;
  onClose: () => void;
  onCreated?: (task: Task) => void;
}

const ENERGY_OPTIONS: { value: Energy; label: string }[] = [
  { value: "deep", label: "Deep focus" },
  { value: "shallow", label: "Light admin" },
  { value: "creative", label: "Creative" },
  { value: "social", label: "Social" },
];

export function NewTaskModal({
  uid,
  projectId,
  onClose,
  onCreated,
}: NewTaskModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [durationHours, setDurationHours] = useState(1);
  const [due, setDue] = useState("");
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
      const durationMinutes = Math.max(
        15,
        Math.round(durationHours * 60),
      );
      const task: Task = {
        id: `t_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        projectId,
        ownerId: uid,
        title: title.trim(),
        description: description.trim() || undefined,
        kind: "task",
        start: null,
        end: null,
        energy,
        durationMinutes,
        timeZone:
          typeof Intl !== "undefined"
            ? Intl.DateTimeFormat().resolvedOptions().timeZone
            : "UTC",
        priority: { score: 0, factors: [] },
        pinned: false,
        autoPlaced: false,
        due: due ? new Date(due).toISOString() : undefined,
        splittable: durationMinutes > 60,
        minBlockMinutes: 45,
        progress: 0,
        status: "open",
        createdAt: now,
        updatedAt: now,
      };
      await upsertTask({ uid, projectId }, task);
      onCreated?.(task);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the task.");
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
        aria-labelledby="new-task-title"
        initial={{ y: 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 12, opacity: 0 }}
        transition={{ duration: 0.22, ease }}
        onClick={(e) => e.stopPropagation()}
        className="bg-background border border-border w-full max-w-md shadow-[0_30px_80px_-20px_rgba(0,0,0,0.4)]"
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <span
            id="new-task-title"
            className="text-[10px] uppercase tracking-[0.18em] text-muted font-semibold"
          >
            New task
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
            placeholder="e.g. Draft methodology section"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            className="w-full font-display font-bold text-[20px] tracking-[-0.02em] bg-transparent border-b border-border focus:border-violet outline-none py-1 placeholder:text-muted"
          />

          <div className="grid grid-cols-3 gap-3">
            <Field label="Hours">
              <input
                type="number"
                min={0.25}
                step={0.25}
                value={durationHours}
                onChange={(e) => setDurationHours(Number(e.target.value))}
                className="w-full border border-border bg-background px-2 py-1.5 text-[13px] tabular-nums focus:border-violet/50 outline-none"
              />
            </Field>
            <Field label="Due (optional)">
              <input
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                className="w-full border border-border bg-background px-2 py-1.5 text-[13px] focus:border-violet/50 outline-none"
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

          <Field label="Notes (optional)">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Anything Tempo should know to schedule this well"
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
            Create task
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
