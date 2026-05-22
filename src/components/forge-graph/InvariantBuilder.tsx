"use client";

/**
 * InvariantBuilder — the Phase 4 builder UI.
 *
 * Renders a single editable invariant card: name, blocking toggle,
 * enabled toggle, and a kind-specific control set driven by
 * `INVARIANT_CATALOGUE`. Owned by the parent page; this component is
 * pure presentational + change callbacks.
 *
 * Design language matches Forge's existing system: monospace eyebrow,
 * border + bg-surface card, violet accents, uppercase tracking. No new
 * tokens introduced.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown, Trash2, Lock, Unlock } from "lucide-react";
import { ForgeNodeCategory } from "@/lib/forge-graph/types";
import {
  type InvariantConfig,
  INVARIANT_CATALOGUE,
} from "@/lib/forge-graph/invariant-dsl";

const EASE = [0.22, 0.61, 0.36, 1] as const;

interface InvariantBuilderProps {
  config: InvariantConfig;
  onChange: (patch: Partial<InvariantConfig>) => void;
  onRemove: () => void;
  /** Optional run-time evaluation outcome shown next to the card. */
  status?: { passed: boolean; detail?: string };
}

export function InvariantBuilder({
  config,
  onChange,
  onRemove,
  status,
}: InvariantBuilderProps) {
  const meta = INVARIANT_CATALOGUE.find((m) => m.kind === config.kind);
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: EASE }}
      className="relative border border-border bg-surface p-5"
    >
      <span
        aria-hidden
        className={`absolute left-0 top-5 bottom-5 w-[2px] ${
          config.enabled
            ? config.blocking
              ? "bg-violet"
              : "bg-warm"
            : "bg-border"
        }`}
      />

      {/* header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] uppercase tracking-[0.18em] font-semibold text-muted">
              Invariant
            </span>
            <span className="text-[10px] text-muted">·</span>
            <span className="text-[10px] uppercase tracking-[0.12em] font-medium text-muted">
              {meta?.label ?? config.kind}
            </span>
            {status ? (
              <span
                className={`text-[9px] uppercase tracking-[0.14em] font-medium ${
                  status.passed ? "text-green" : "text-rose"
                }`}
              >
                · {status.passed ? "Passing" : "Failing"}
              </span>
            ) : null}
          </div>

          <input
            type="text"
            value={config.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="Rule name"
            className="w-full bg-transparent border-b border-border focus:border-violet/50 outline-none text-[15px] text-foreground py-1 transition-colors"
          />
          {meta ? (
            <p className="text-[11px] text-muted mt-2 leading-snug">{meta.summary}</p>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <ToggleChip
            on={config.enabled}
            onChange={(v) => onChange({ enabled: v })}
            label="Enabled"
          />
          <ToggleChip
            on={config.blocking}
            onChange={(v) => onChange({ blocking: v })}
            label="Blocking"
            icon={config.blocking ? Lock : Unlock}
            activeClass="text-violet border-violet/40 bg-violet/[0.06]"
          />
          <button
            type="button"
            onClick={onRemove}
            className="p-1.5 text-muted hover:text-rose transition-colors"
            title="Remove invariant"
          >
            <Trash2 size={13} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* kind-specific controls */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {renderControls(config, onChange)}
      </div>

      {status && !status.passed && status.detail ? (
        <p className="mt-4 text-[11px] text-rose leading-relaxed">{status.detail}</p>
      ) : null}
    </motion.div>
  );
}

/* ──────── per-kind controls ──────── */

function renderControls(
  config: InvariantConfig,
  onChange: (patch: Partial<InvariantConfig>) => void,
) {
  switch (config.kind) {
    case "deep-work-floor":
      return (
        <NumberField
          label="Hours / day"
          min={0}
          max={24}
          step={0.5}
          value={config.params.minHours}
          onChange={(v) => onChange({ params: { minHours: v } })}
        />
      );
    case "daily-commitment-ceiling":
      return (
        <NumberField
          label="Hours / day"
          min={0}
          max={24}
          step={0.5}
          value={config.params.maxHours}
          onChange={(v) => onChange({ params: { maxHours: v } })}
        />
      );
    case "dependency-buffer":
      return (
        <NumberField
          label="Buffer hours"
          min={0}
          max={168}
          step={0.25}
          value={config.params.bufferHours}
          onChange={(v) => onChange({ params: { bufferHours: v } })}
        />
      );
    case "no-calendar-overlap":
    case "goal-deadline-protected":
      return (
        <p className="col-span-full text-[11px] text-muted italic">
          No parameters — the rule applies workspace-wide.
        </p>
      );
    case "per-day-event-count":
      return (
        <NumberField
          label="Max events / day"
          min={0}
          max={50}
          step={1}
          value={config.params.maxCount}
          onChange={(v) => onChange({ params: { maxCount: Math.round(v) } })}
        />
      );
    case "node-field-range":
      return (
        <>
          <CategorySelect
            value={config.params.category}
            onChange={(category) =>
              onChange({
                params: {
                  category,
                  field: config.params.field,
                  min: config.params.min,
                  max: config.params.max,
                },
              })
            }
          />
          <TextField
            label="Field"
            value={config.params.field}
            onChange={(field) =>
              onChange({
                params: {
                  category: config.params.category,
                  field,
                  min: config.params.min,
                  max: config.params.max,
                },
              })
            }
          />
          <NumberField
            label="Min"
            value={config.params.min ?? 0}
            onChange={(min) =>
              onChange({
                params: {
                  category: config.params.category,
                  field: config.params.field,
                  min,
                  max: config.params.max,
                },
              })
            }
          />
          <NumberField
            label="Max"
            value={config.params.max ?? 100}
            onChange={(max) =>
              onChange({
                params: {
                  category: config.params.category,
                  field: config.params.field,
                  min: config.params.min,
                  max,
                },
              })
            }
          />
        </>
      );
    case "node-field-equals":
      return (
        <>
          <CategorySelect
            value={config.params.category}
            onChange={(category) =>
              onChange({
                params: {
                  category,
                  field: config.params.field,
                  expected: config.params.expected,
                },
              })
            }
          />
          <TextField
            label="Field"
            value={config.params.field}
            onChange={(field) =>
              onChange({
                params: {
                  category: config.params.category,
                  field,
                  expected: config.params.expected,
                },
              })
            }
          />
          <TextField
            label="Expected value"
            value={config.params.expected}
            onChange={(expected) =>
              onChange({
                params: {
                  category: config.params.category,
                  field: config.params.field,
                  expected,
                },
              })
            }
          />
        </>
      );
  }
}

/* ──────── primitive controls ──────── */

interface ToggleChipProps {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  icon?: typeof Lock;
  activeClass?: string;
}

function ToggleChip({
  on,
  onChange,
  label,
  icon: Icon,
  activeClass = "text-green border-green/40 bg-green/[0.06]",
}: ToggleChipProps) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={`flex items-center gap-1.5 px-2.5 py-1 text-[9px] uppercase tracking-[0.14em] font-semibold border transition-colors ${
        on ? activeClass : "text-muted border-border hover:border-foreground/30"
      }`}
    >
      {Icon ? <Icon size={10} strokeWidth={2} /> : null}
      {label}
    </button>
  );
}

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

function NumberField({ label, value, onChange, min, max, step }: NumberFieldProps) {
  return (
    <label className="block">
      <span className="text-[9px] uppercase tracking-[0.16em] font-medium text-muted block mb-1.5">
        {label}
      </span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        className="w-full bg-background border border-border focus:border-violet/50 outline-none px-3 py-2 text-[13px] text-foreground tabular-nums transition-colors"
      />
    </label>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
}

function TextField({ label, value, onChange }: TextFieldProps) {
  return (
    <label className="block">
      <span className="text-[9px] uppercase tracking-[0.16em] font-medium text-muted block mb-1.5">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-background border border-border focus:border-violet/50 outline-none px-3 py-2 text-[13px] text-foreground transition-colors"
      />
    </label>
  );
}

interface CategorySelectProps {
  value: ForgeNodeCategory | "ANY";
  onChange: (v: ForgeNodeCategory | "ANY") => void;
}

function CategorySelect({ value, onChange }: CategorySelectProps) {
  const [open, setOpen] = useState(false);
  const options: Array<{ value: ForgeNodeCategory | "ANY"; label: string }> = [
    { value: "ANY", label: "Any node" },
    { value: ForgeNodeCategory.DATA, label: "Data" },
    { value: ForgeNodeCategory.GOAL, label: "Goal" },
    { value: ForgeNodeCategory.CALENDAR_EVENT, label: "Calendar event" },
    { value: ForgeNodeCategory.TASK, label: "Task" },
    { value: ForgeNodeCategory.PROSE, label: "Prose" },
  ];
  const current = options.find((o) => o.value === value)?.label ?? "Any node";

  return (
    <label className="block relative">
      <span className="text-[9px] uppercase tracking-[0.16em] font-medium text-muted block mb-1.5">
        Category
      </span>
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="w-full flex items-center justify-between bg-background border border-border focus:border-violet/50 outline-none px-3 py-2 text-[13px] text-foreground transition-colors"
      >
        <span>{current}</span>
        <ChevronDown
          size={11}
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <ul className="absolute z-10 top-full left-0 right-0 mt-1 border border-border bg-surface shadow-[0_8px_24px_-12px_rgba(0,0,0,0.25)]">
          {options.map((o) => (
            <li key={o.value}>
              <button
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-[12px] transition-colors ${
                  o.value === value
                    ? "text-foreground bg-background border-l-2 border-violet"
                    : "text-muted hover:text-foreground hover:bg-background"
                }`}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </label>
  );
}
