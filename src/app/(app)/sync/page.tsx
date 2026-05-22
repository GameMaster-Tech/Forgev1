"use client";

/**
 * Sync — Overview.
 *
 * Two-column layout (8/4 on desktop). The main column hosts a
 * featured "verdict" card that mirrors the FeaturedRow pattern from
 * /projects — small eyebrow, big display headline, inline meta. Below
 * it, a preview of the top few conflicts (numbered list) with a link
 * out to the full /sync/conflicts route. The rail carries an
 * informational legend (what the stats mean) and the principle
 * manifesto card.
 */

import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Lock,
  ShieldCheck,
  Sparkles,
  GitBranch,
} from "lucide-react";
import type { Assertion, Violation } from "@/lib/sync";
import { useSync } from "./SyncProvider";
import { ease } from "./_components";

const TOP_PREVIEW = 3;

export default function SyncOverviewPage() {
  const {
    report,
    violations,
    assertionsById,
    documentsCount,
    hasPatch,
    patchChanges,
  } = useSync();

  const topConflicts = violations.slice(0, TOP_PREVIEW);

  return (
    <div className="grid grid-cols-12 gap-x-0">
      {/* ── Main column ────────────────────────────────────── */}
      <div className="col-span-12 lg:col-span-8 px-6 sm:px-10 pt-8 pb-16 lg:border-r lg:border-border">
        <VerdictFeatured
          isStable={report.isStable}
          hard={report.hardViolations}
          soft={report.softViolations}
          assertions={report.assertionsChecked}
          constraints={report.constraintsChecked}
          documents={documentsCount}
          hasPatch={hasPatch}
          patchChanges={patchChanges}
          ranAt={report.ranAt}
        />

        {topConflicts.length > 0 ? (
          <div className="mt-10 pt-6 border-t border-border">
            <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium">
                Top conflicts
              </p>
              <Link
                href="/sync/conflicts"
                prefetch
                className="text-[10px] uppercase tracking-[0.12em] font-semibold text-violet hover:underline inline-flex items-center gap-1.5"
              >
                See all
                <ArrowRight size={11} strokeWidth={2} />
              </Link>
            </div>
            <ul className="divide-y divide-border border-t border-b border-border">
              {topConflicts.map((v, i) => (
                <ConflictPreviewRow
                  key={v.constraintId}
                  v={v}
                  index={i + 1}
                  assertions={assertionsById}
                />
              ))}
            </ul>
          </div>
        ) : (
          <div className="mt-10 pt-6 border-t border-border">
            <CleanPreview />
          </div>
        )}
      </div>

      {/* ── Right rail companion ────────────────────────────── */}
      <aside className="col-span-12 lg:col-span-4 px-6 sm:px-10 pt-8 pb-16 space-y-6">
        <StateLegend
          hard={report.hardViolations}
          soft={report.softViolations}
          assertions={report.assertionsChecked}
          constraints={report.constraintsChecked}
        />
        <ManifestoCard />
      </aside>
    </div>
  );
}

/* ── Featured verdict card ─────────────────────────────────── */

function VerdictFeatured({
  isStable, hard, soft, assertions, constraints, documents, hasPatch, patchChanges, ranAt,
}: {
  isStable: boolean;
  hard: number;
  soft: number;
  assertions: number;
  constraints: number;
  documents: number;
  hasPatch: boolean;
  patchChanges: number;
  ranAt: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease }}
    >
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
        Status
      </p>
      <div className="border border-border bg-surface p-5 sm:p-6 relative">
        <span
          aria-hidden
          className={`absolute left-0 top-5 bottom-5 w-[2px] ${isStable ? "bg-green" : "bg-rose"}`}
        />
        <div className="flex items-center gap-2.5 mb-2">
          <span
            className={`flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] font-semibold ${isStable ? "text-green" : "text-rose"}`}
          >
            {isStable ? <CheckCircle2 size={11} strokeWidth={2} /> : <AlertTriangle size={11} strokeWidth={2} />}
            {isStable ? "All good" : "Conflicts found"}
          </span>
          <span className="w-1 h-1 bg-muted rounded-full" />
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums">
            checked {new Date(ranAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </span>
        </div>
        <h2 className="font-display font-bold text-foreground text-2xl sm:text-3xl tracking-[-0.022em] leading-[1.1]">
          {isStable ? (
            <>Your numbers <span className="text-violet">add up</span>.</>
          ) : (
            <>
              <span className="text-rose">{hard + soft} {hard + soft === 1 ? "conflict" : "conflicts"}</span> across your docs.
            </>
          )}
        </h2>
        <p className="text-[13px] text-muted mt-3 leading-relaxed max-w-xl">
          {isStable
            ? "Every number lines up. Nothing to fix."
            : "Run a patch — Forge will suggest values that make everything consistent."}
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] uppercase tracking-[0.12em] text-muted tabular-nums font-medium">
          {hard > 0 && (
            <span className="flex items-center gap-1.5 text-rose">
              <span aria-hidden className="w-1.5 h-1.5 bg-rose" />
              {hard} hard
            </span>
          )}
          {soft > 0 && (
            <span className="flex items-center gap-1.5 text-warm">
              <span aria-hidden className="w-1.5 h-1.5 bg-warm" />
              {soft} soft
            </span>
          )}
          <span>{assertions} variables</span>
          <span>{constraints} constraints</span>
          <span>{documents} docs</span>
          {hasPatch && (
            <Link
              href="/sync/patch"
              prefetch
              className="ml-auto inline-flex items-center gap-1.5 text-violet hover:gap-2.5 transition-all"
            >
              {patchChanges} change{patchChanges === 1 ? "" : "s"} ready
              <ArrowRight size={12} strokeWidth={2} />
            </Link>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/* ── Conflict preview row (numbered) ───────────────────────── */

function ConflictPreviewRow({
  v, index, assertions,
}: {
  v: Violation;
  index: number;
  assertions: Map<string, Assertion>;
}) {
  const involved = v.involved.map((id) => assertions.get(id)).filter(Boolean) as Assertion[];
  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.max(0, index - 1) * 0.04, ease }}
    >
      <Link
        href={`/sync/conflicts#conflict-${v.constraintId}`}
        prefetch
        className="group grid grid-cols-12 items-start gap-x-4 sm:gap-x-6 py-4 hover:bg-violet/[0.06] transition-colors -mx-3 px-3 sm:-mx-4 sm:px-4"
      >
        <span className="col-span-1 font-display font-bold text-muted text-[13px] tabular-nums tracking-tight pt-0.5">
          {String(index).padStart(2, "0")}
        </span>
        <div className="col-span-10 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span
              className={`flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] font-semibold ${v.severity === "hard" ? "text-rose" : "text-warm"}`}
            >
              <span aria-hidden className={`w-1.5 h-1.5 ${v.severity === "hard" ? "bg-rose" : "bg-warm"}`} />
              {v.severity === "hard" ? "Hard" : "Soft"}
            </span>
            <span className="text-[10px] text-muted">·</span>
            <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums">
              Δ {v.magnitude.toLocaleString()}
            </span>
          </div>
          <p className="text-[13.5px] text-foreground leading-snug">{v.message}</p>
          {involved.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {involved.slice(0, 3).map((a) => (
                <span
                  key={a.id}
                  className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium inline-flex items-center gap-1"
                >
                  {a.locked && <Lock size={9} />} {a.label}
                </span>
              ))}
            </div>
          )}
        </div>
        <span className="col-span-1 flex justify-end pt-1">
          <ArrowRight
            size={13}
            strokeWidth={1.75}
            className="text-muted group-hover:text-violet transition-colors"
          />
        </span>
      </Link>
    </motion.li>
  );
}

/* ── Clean-state preview ───────────────────────────────────── */

function CleanPreview() {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
        All clear
      </p>
      <div className="border border-border bg-surface px-5 py-6">
        <div className="flex items-start gap-4">
          <div className="w-8 h-8 border border-border bg-background flex items-center justify-center shrink-0">
            <CheckCircle2 size={14} className="text-green" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-display font-bold text-foreground text-[18px] tracking-[-0.018em]">
              Nothing to fix.
            </h3>
            <p className="text-[12.5px] text-muted leading-relaxed mt-1.5">
              Your numbers all line up. Hit Compile to re-check.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Right rail: stats legend ──────────────────────────────── */

function StateLegend({
  hard, soft, assertions, constraints,
}: {
  hard: number; soft: number; assertions: number; constraints: number;
}) {
  const rows = [
    { key: "hard",        label: "Hard conflicts",  accent: hard > 0 ? "text-rose" : "text-muted", count: hard,        hint: "Must fix before saving." },
    { key: "soft",        label: "Soft warnings",   accent: soft > 0 ? "text-warm" : "text-muted", count: soft,        hint: "Worth a look. Not blocking." },
    { key: "assertions",  label: "Numbers tracked", accent: "text-foreground",                    count: assertions,  hint: "Values Forge is watching." },
    { key: "constraints", label: "Rules",           accent: "text-foreground",                    count: constraints, hint: "Conditions every number must meet." },
  ];
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.1, ease }}
    >
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
        Current state
      </p>
      <div className="border border-border bg-surface divide-y divide-border">
        {rows.map((r) => (
          <div key={r.key} className="flex items-start gap-3.5 px-4 py-3.5">
            <div className="mt-0.5 w-9 h-9 border border-border bg-background flex items-center justify-center shrink-0">
              <span className={`font-display font-bold tabular-nums text-[14px] tracking-tight ${r.accent}`}>{r.count}</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className={`text-[10px] uppercase tracking-[0.15em] font-semibold ${r.accent}`}>{r.label}</div>
              <p className="text-[12px] text-muted leading-relaxed mt-0.5">{r.hint}</p>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

/* ── Right rail: manifesto card ────────────────────────────── */

function ManifestoCard() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.18, ease }}
      className="border border-border bg-foreground text-background p-5 relative overflow-hidden"
    >
      <span aria-hidden className="absolute top-0 left-0 w-[2px] h-full bg-violet" />
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={12} strokeWidth={2} className="text-violet" />
        <span className="text-[10px] uppercase tracking-[0.18em] text-background/60 font-medium">
          The principle
        </span>
      </div>
      <h3 className="font-display font-bold text-[18px] tracking-[-0.018em] leading-[1.2] mb-3">
        Assistants make mistakes. <span className="text-violet">Compilers find them.</span>
      </h3>
      <p className="text-[13px] text-background/70 leading-relaxed mb-4">
        Forge proves the workspace is internally consistent before you ship. Lock the values you trust; the solver rebalances the rest against May-2026 market anchors.
      </p>
      <div className="flex items-center gap-1.5 text-[11px] text-background/55 font-medium">
        <ShieldCheck size={11} strokeWidth={1.75} />
        Deterministic · auditable · reversible
      </div>
    </motion.div>
  );
}
