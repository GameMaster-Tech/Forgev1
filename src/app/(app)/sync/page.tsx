"use client";

/**
 * Sync — Epistemic Compiler, cross-document constraint dashboard.
 *
 * Layout mirrors the Projects page: 8/4 main + rail. Main column
 * walks the violations and the proposed patch; rail explains the
 * "Stable State" verdict and lists every document the linter is
 * watching.
 */

import { useMemo, useState } from "react";
import { useRegisterCommandSource, makeCommandId, type CommandItem } from "@/hooks/useCommandPalette";
import { motion, AnimatePresence } from "framer-motion";
import {
  GitBranch,
  AlertTriangle,
  Lock,
  Sparkles,
  CheckCircle2,
  ArrowRight,
  FileText,
  Cpu,
  ShieldCheck,
  Loader2,
  RotateCcw,
  Undo2,
  History,
} from "lucide-react";
import {
  buildDemoGraph,
  checkStability,
  detectViolations,
  proposePatch,
  applyPatch,
  DependencyGraph,
  captureUndo,
  pushUndo,
  revertLast,
  formatUndoTimestamp,
  type LogicalPatch,
  type StabilityReport,
  type Violation,
  type Assertion,
  type DocumentNode,
  type UndoEntry,
} from "@/lib/sync";

const ease = [0.22, 0.61, 0.36, 1] as const;

export default function SyncPage() {
  const [graph, setGraph] = useState<DependencyGraph>(() => buildDemoGraph());
  const [patch, setPatch] = useState<LogicalPatch | null>(null);
  const [computing, setComputing] = useState(false);
  const [undoLog, setUndoLog] = useState<UndoEntry[]>([]);

  const report = useMemo<StabilityReport>(() => checkStability(graph), [graph]);

  const handleCompile = () => {
    setComputing(true);
    // Run on next tick so the spinner can render — solver is sync but
    // we want the UI to feel like it's working.
    setTimeout(() => {
      const next = proposePatch(graph, { now: Date.now() });
      setPatch(next);
      setComputing(false);
    }, 350);
  };

  const handleApply = () => {
    if (!patch) return;
    const clone = cloneGraph(graph);
    // Capture the undo entry from the PRE-apply state (clone still has
    // the original values) before we mutate it.
    const entry = captureUndo(clone, patch);
    applyPatch(clone, patch);
    setGraph(clone);
    setUndoLog((prev) => pushUndo(prev, entry));
    setPatch(null);
  };

  const handleUndo = () => {
    if (undoLog.length === 0) return;
    const clone = cloneGraph(graph);
    const { buffer } = revertLast(clone, undoLog);
    setGraph(clone);
    setUndoLog(buffer);
    setPatch(null);
  };

  const handleReset = () => {
    setGraph(buildDemoGraph());
    setPatch(null);
    setUndoLog([]);
  };

  const docs = graph.listDocuments();
  const allViolations = currentViolations(graph);
  const assertionsById = mapAssertions(graph.listAssertions());

  // Register assertion + document items with the command palette.
  const assertionItems = useMemo<CommandItem[]>(() => {
    return graph.listAssertions().map((a) => ({
      id: makeCommandId("sync.assertion", a.id),
      kind: "assertion",
      label: a.label,
      subtitle: `${a.key} · ${a.kind}`,
      keywords: [a.key, a.kind, a.documentId, a.source ?? ""],
      href: "/sync",
      anchor: `assertion-${a.id}`,
    }));
  }, [graph]);
  const documentItems = useMemo<CommandItem[]>(() => {
    return docs.map((d) => ({
      id: makeCommandId("sync.document", d.id),
      kind: "document",
      label: d.title,
      subtitle: `${d.type} · ${d.assertionIds.length} variables`,
      keywords: [d.type, d.id],
      href: "/sync",
      anchor: `doc-${d.id}`,
    }));
  }, [docs]);
  useRegisterCommandSource("sync.assertions", assertionItems);
  useRegisterCommandSource("sync.documents", documentItems);

  return (
    <div className="min-h-full bg-background">
      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease }}
        className="border-b border-border px-6 sm:px-10 pt-10 pb-6 flex flex-col gap-5"
      >
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-2 flex items-center gap-2">
              <GitBranch size={11} strokeWidth={1.75} />
              Sync · cross-document compiler
            </p>
            <h1 className="font-display font-extrabold text-3xl sm:text-4xl text-foreground tracking-[-0.025em] leading-[1.05]">
              {report.isStable ? (
                <>Workspace is <span className="text-violet">compiled</span>.</>
              ) : (
                <>Workspace has <span className="text-rose">{allViolations.length} conflicts</span>.</>
              )}
            </h1>
            <p className="text-[13px] text-muted mt-2 max-w-xl leading-relaxed">
              Forge treats every commitment as a variable. The linter walks the dependency graph between your docs and finds paradoxes — then proposes a patch that drives the whole project to a Stable State.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleReset}
              className="flex items-center gap-2 border border-border text-foreground hover:border-violet hover:text-violet text-[11px] font-semibold uppercase tracking-[0.12em] px-4 py-2.5 transition-colors duration-150"
            >
              <RotateCcw size={12} strokeWidth={2.25} />
              Reset demo
            </button>
            <button
              onClick={handleCompile}
              disabled={computing}
              className="flex items-center gap-2 bg-violet text-white hover:bg-violet/90 disabled:opacity-60 text-[11px] font-semibold uppercase tracking-[0.12em] px-5 py-2.5 transition-colors duration-150 btn-glow-violet"
            >
              {computing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} strokeWidth={2.25} />}
              Compile workspace
            </button>
          </div>
        </div>

        {/* Stat strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
          <Stat label="Assertions" value={report.assertionsChecked} hint="variables tracked" tone="violet" />
          <Stat label="Constraints" value={report.constraintsChecked} hint="rules enforced" tone="cyan" />
          <Stat label="Hard conflicts" value={report.hardViolations} hint="must resolve" tone={report.hardViolations > 0 ? "rose" : "green"} />
          <Stat label="Soft warnings" value={report.softViolations} hint="advisory" tone={report.softViolations > 0 ? "warm" : "green"} />
        </div>
      </motion.header>

      {/* Body */}
      <div className="grid grid-cols-12 gap-x-0">
        {/* Main */}
        <div className="col-span-12 lg:col-span-8 px-6 sm:px-10 pb-16 lg:border-r lg:border-border">
          {/* Patch panel */}
          <AnimatePresence>
            {patch && (
              <motion.section
                key="patch"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.3, ease }}
                className="mt-8 border border-violet bg-foreground text-background relative overflow-hidden"
              >
                <span aria-hidden className="absolute left-0 top-0 h-full w-[3px] bg-violet" />
                <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles size={13} className="text-violet" strokeWidth={2.25} />
                    <span className="text-[10px] uppercase tracking-[0.18em] text-background/60 font-medium">
                      Proposed logical patch · {patch.iterations} iter
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] font-medium">
                    {patch.reachesStableState ? (
                      <span className="flex items-center gap-1 text-green">
                        <CheckCircle2 size={11} /> Reaches stable
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-amber">
                        <AlertTriangle size={11} /> Partial
                      </span>
                    )}
                  </div>
                </div>
                <div className="px-5 py-4">
                  <p className="text-[13px] text-background/80 leading-relaxed mb-4">
                    {patch.summary}
                  </p>
                  <div className="space-y-2">
                    {patch.changes.map((c) => {
                      const a = assertionsById.get(c.assertionId);
                      if (!a) return null;
                      return (
                        <div key={c.assertionId} className="border border-white/[0.08] bg-white/[0.02] px-4 py-3">
                          <div className="flex items-baseline gap-2 mb-1">
                            <span className="text-[11px] uppercase tracking-[0.14em] text-background/55 font-medium">{a.label}</span>
                            <span className="text-[10px] text-background/40">·</span>
                            <span className="text-[10px] uppercase tracking-[0.12em] text-violet font-semibold">
                              {(c.confidence * 100).toFixed(0)}% conf
                            </span>
                          </div>
                          <div className="font-display font-bold text-[18px] tabular-nums flex items-center gap-2 flex-wrap">
                            <span className="text-rose/80 line-through decoration-rose/60 decoration-[1.5px]">{describe(c.before)}</span>
                            <ArrowRight size={13} className="text-background/40" />
                            <span className="text-violet">{describe(c.after)}</span>
                          </div>
                          <p className="text-[12px] text-background/65 leading-relaxed mt-1.5">{c.rationale}</p>
                          {c.marketRef && (
                            <div className="text-[10px] uppercase tracking-[0.14em] text-cyan font-medium mt-1.5">
                              <Cpu size={9} className="inline mr-1" /> {c.marketRef}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-5 flex items-center gap-2">
                    <button
                      onClick={handleApply}
                      className="flex items-center gap-2 bg-violet text-white hover:bg-violet/90 text-[11px] font-semibold uppercase tracking-[0.12em] px-5 py-2.5 transition-colors duration-150"
                    >
                      <CheckCircle2 size={12} strokeWidth={2.25} />
                      Apply patch
                    </button>
                    <button
                      onClick={() => setPatch(null)}
                      className="text-[11px] uppercase tracking-[0.12em] text-background/55 hover:text-background font-semibold px-4 py-2.5"
                    >
                      Discard
                    </button>
                  </div>
                </div>
              </motion.section>
            )}
          </AnimatePresence>

          {/* Violations */}
          <section className="mt-10">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
              Current state · {allViolations.length === 0 ? "clean" : `${allViolations.length} unresolved`}
            </p>
            {allViolations.length === 0 ? (
              <CleanState />
            ) : (
              <ul className="divide-y divide-border border-y border-border">
                {allViolations.map((v, i) => (
                  <ViolationRow key={v.constraintId} v={v} index={i + 1} assertions={assertionsById} />
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Rail */}
        <aside className="col-span-12 lg:col-span-4 px-6 sm:px-10 pt-8 pb-16 space-y-6">
          <VerdictCard report={report} undoCount={undoLog.length} onUndo={handleUndo} />
          <UndoLog entries={undoLog} />
          <DocumentLegend docs={docs} assertions={graph.listAssertions()} />
          <PrincipleCard />
        </aside>
      </div>
    </div>
  );
}

/* ─────── helpers ─────── */

function currentViolations(g: DependencyGraph): Violation[] {
  return detectViolations(g);
}

function mapAssertions(list: Assertion[]): Map<string, Assertion> {
  return new Map(list.map((a) => [a.id, a] as const));
}

function cloneGraph(g: DependencyGraph): DependencyGraph {
  const next = new DependencyGraph(g.projectId);
  for (const d of g.listDocuments()) next.upsertDocument(d);
  for (const a of g.listAssertions()) next.upsertAssertion(a);
  for (const c of g.listConstraints()) next.upsertConstraint(c);
  return next;
}

function describe(v: Assertion["value"]): string {
  switch (v.type) {
    case "number": return `${v.value.toLocaleString()}${v.unit ? " " + v.unit : ""}`;
    case "string": return `"${v.value}"`;
    case "date": return v.value;
    case "boolean": return v.value ? "true" : "false";
  }
}

/* ─────── building blocks ─────── */

function Stat({ label, value, hint, tone }: { label: string; value: number; hint: string; tone: "violet" | "cyan" | "rose" | "warm" | "green" }) {
  const accent =
    tone === "violet" ? "text-violet" :
    tone === "cyan" ? "text-cyan" :
    tone === "rose" ? "text-rose" :
    tone === "warm" ? "text-warm" : "text-green";
  const card =
    tone === "rose" ? "stat-card-rose" :
    tone === "warm" ? "stat-card-warm" :
    tone === "green" ? "stat-card-green" : "stat-card-cyan";
  return (
    <div className={`${card} p-3.5`}>
      <p className="text-[10px] uppercase tracking-[0.15em] text-muted font-medium">{label}</p>
      <p className={`font-display font-extrabold text-2xl tabular-nums tracking-[-0.02em] mt-1 ${accent}`}>{value}</p>
      <p className="text-[11px] text-muted mt-0.5">{hint}</p>
    </div>
  );
}

function ViolationRow({ v, index, assertions }: { v: Violation; index: number; assertions: Map<string, Assertion> }) {
  const involved = v.involved.map((id) => assertions.get(id)).filter(Boolean) as Assertion[];
  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.02, ease }}
      className="py-4"
    >
      <div className="flex items-start gap-4">
        <span className="font-display font-bold text-muted text-[13px] tabular-nums tracking-tight pt-0.5 shrink-0 w-8">
          {String(index).padStart(2, "0")}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] font-semibold ${v.severity === "hard" ? "text-rose" : "text-warm"}`}>
              <span className={`w-1.5 h-1.5 ${v.severity === "hard" ? "bg-rose" : "bg-warm"}`} />
              {v.severity === "hard" ? "Hard conflict" : "Soft warning"}
            </span>
            <span className="text-[10px] text-muted">·</span>
            <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums">
              Δ {v.magnitude.toLocaleString()}
            </span>
          </div>
          <p className="text-[14px] text-foreground leading-relaxed">{v.message}</p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {involved.map((a) => (
              <span key={a.id} className="text-[10px] uppercase tracking-[0.12em] border border-border bg-surface text-muted px-2 py-1 font-medium inline-flex items-center gap-1">
                {a.locked && <Lock size={9} />} {a.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </motion.li>
  );
}

function VerdictCard({ report, undoCount, onUndo }: { report: StabilityReport; undoCount: number; onUndo: () => void }) {
  const stable = report.isStable;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.1, ease }}
      className={`border border-border ${stable ? "bg-foreground text-background" : "bg-surface"} p-5 relative overflow-hidden`}
    >
      <span aria-hidden className={`absolute top-0 left-0 w-[2px] h-full ${stable ? "bg-green" : "bg-rose"}`} />
      <div className="flex items-center gap-2 mb-3">
        {stable ? <CheckCircle2 size={12} strokeWidth={2.25} className="text-green" /> : <AlertTriangle size={12} strokeWidth={2.25} className="text-rose" />}
        <span className={`text-[10px] uppercase tracking-[0.18em] font-medium ${stable ? "text-background/60" : "text-muted"}`}>
          Stability verdict
        </span>
      </div>
      <h3 className={`font-display font-bold text-[20px] tracking-[-0.02em] leading-[1.2] mb-3 ${stable ? "" : "text-foreground"}`}>
        {stable ? <>Compiled <span className="text-green">cleanly</span>.</> : <>Paradox <span className="text-rose">detected</span>.</>}
      </h3>
      <p className={`text-[13px] leading-relaxed ${stable ? "text-background/70" : "text-muted"}`}>
        {stable
          ? "Every variable across your documents satisfies every declared constraint. Ship with confidence."
          : "Run the compiler to generate a proposed patch — it will anchor flexible values against May-2026 market data."}
      </p>
      <p className={`text-[10px] uppercase tracking-[0.15em] mt-3 ${stable ? "text-background/45" : "text-muted"} font-medium tabular-nums`}>
        Last linted {new Date(report.ranAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
      </p>
      {undoCount > 0 && (
        <button
          onClick={onUndo}
          className={`mt-4 w-full flex items-center justify-center gap-2 border ${stable ? "border-white/[0.12] text-background hover:border-violet hover:text-violet" : "border-border text-foreground hover:border-violet hover:text-violet"} text-[11px] font-semibold uppercase tracking-[0.12em] px-4 py-2.5 transition-colors duration-150`}
          aria-label="Undo last applied patch"
        >
          <Undo2 size={12} strokeWidth={2.25} />
          Undo last patch
        </button>
      )}
    </motion.div>
  );
}

function UndoLog({ entries }: { entries: UndoEntry[] }) {
  if (entries.length === 0) return null;
  const reversed = [...entries].reverse(); // newest first
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.14, ease }}
    >
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3 flex items-center gap-2">
        <History size={11} strokeWidth={1.75} />
        Audit trail · {entries.length} applied patch{entries.length === 1 ? "" : "es"}
      </p>
      <ol className="border border-border bg-surface divide-y divide-border">
        {reversed.map((e, i) => (
          <li key={`${e.id}-${e.appliedAt}`} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums">
                #{reversed.length - i}
              </span>
              <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums">
                {formatUndoTimestamp(e.appliedAt)}
              </span>
            </div>
            <p className="text-[12px] text-foreground leading-relaxed line-clamp-2 break-words">
              {e.summary || `${e.changedCount} change${e.changedCount === 1 ? "" : "s"}`}
            </p>
          </li>
        ))}
      </ol>
    </motion.div>
  );
}

function DocumentLegend({ docs, assertions }: { docs: DocumentNode[]; assertions: Assertion[] }) {
  const byDoc = new Map<string, number>();
  for (const a of assertions) byDoc.set(a.documentId, (byDoc.get(a.documentId) ?? 0) + 1);
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.18, ease }}
    >
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
        Linked documents
      </p>
      <div className="border border-border bg-surface divide-y divide-border">
        {docs.map((d) => (
          <div key={d.id} className="flex items-center gap-3 px-4 py-3">
            <div className="w-6 h-6 border border-border bg-background flex items-center justify-center shrink-0">
              <FileText size={11} strokeWidth={1.75} className="text-cyan" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] text-foreground font-medium truncate">{d.title}</div>
              <div className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium">
                {d.type} · {byDoc.get(d.id) ?? 0} vars
              </div>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

function PrincipleCard() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.26, ease }}
      className="border border-border bg-foreground text-background p-5 relative overflow-hidden"
    >
      <span aria-hidden className="absolute top-0 left-0 w-[2px] h-full bg-violet" />
      <div className="flex items-center gap-2 mb-3">
        <ShieldCheck size={12} strokeWidth={2} className="text-violet" />
        <span className="text-[10px] uppercase tracking-[0.18em] text-background/60 font-medium">
          The principle
        </span>
      </div>
      <h3 className="font-display font-bold text-[18px] tracking-[-0.018em] leading-[1.2] mb-3">
        Assistants make mistakes. <span className="text-violet">Compilers find them.</span>
      </h3>
      <p className="text-[13px] text-background/70 leading-relaxed">
        Forge proves the workspace is internally consistent before you ship. Lock the values you trust; the linter rebalances the rest using May-2026 market anchors.
      </p>
    </motion.div>
  );
}

function CleanState() {
  return (
    <div className="border border-border bg-surface px-6 py-10 text-center">
      <div className="mx-auto w-10 h-10 border border-border bg-background flex items-center justify-center mb-3">
        <CheckCircle2 size={14} className="text-green" strokeWidth={2} />
      </div>
      <h3 className="font-display font-bold text-foreground text-[18px] tracking-[-0.018em] mb-1">
        Zero conflicts.
      </h3>
      <p className="text-[13px] text-muted leading-relaxed max-w-md mx-auto">
        Apply your patch and the workspace re-compiled. Every variable across every doc satisfies every declared constraint.
      </p>
    </div>
  );
}
