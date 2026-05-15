"use client";

/**
 * Lattice — recursive task decomposition.
 *
 * Layout mirrors Sync/Pulse: 8/4 main + rail. Main column shows the
 * task tree (root prompt → atomic subtasks with status, conditions,
 * drafts). Rail surfaces parser intent, rebranch history, and a
 * principle card.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Network,
  Sparkles,
  RefreshCw,
  Loader2,
  CheckCircle2,
  Circle,
  CirclePause,
  CircleAlert,
  CircleSlash,
  Lock,
  ChevronRight,
  ChevronDown,
  FileText,
  Cpu,
  Eye,
  GitBranch,
  Hourglass,
  CheckSquare,
  X,
} from "lucide-react";
import {
  buildDemoContext,
  DEMO_PARENT_TASKS,
  createWatcher,
  parseIntent,
  resolveTree,
  type AtomicSubtask,
  type ParsedIntent,
  type ProjectContext,
  type RebranchResult,
  type ResolutionCondition,
  type TaskStatus,
  type TaskTree,
} from "@/lib/lattice";

const ease = [0.22, 0.61, 0.36, 1] as const;

const STATUS_META: Record<TaskStatus, { label: string; tone: string; bg: string; icon: typeof CheckCircle2 }> = {
  pending:     { label: "Pending",     tone: "text-muted",  bg: "bg-muted",  icon: Circle },
  in_progress: { label: "In progress", tone: "text-violet", bg: "bg-violet", icon: CirclePause },
  blocked:     { label: "Blocked",     tone: "text-rose",   bg: "bg-rose",   icon: CircleAlert },
  complete:    { label: "Complete",    tone: "text-green",  bg: "bg-green",  icon: CheckCircle2 },
  irrelevant:  { label: "Irrelevant",  tone: "text-muted",  bg: "bg-muted",  icon: CircleSlash },
  "user-locked": { label: "Locked",    tone: "text-cyan",   bg: "bg-cyan",   icon: Lock },
};

export default function LatticePage() {
  // Mutable demo context. We mutate this in-page to demo the watcher's
  // dynamic re-branching.
  const [ctx, setCtx] = useState<ProjectContext | null>(null);
  const [parentTask, setParentTask] = useState<string>(DEMO_PARENT_TASKS[0]);
  const [draftPrompt, setDraftPrompt] = useState<string>(DEMO_PARENT_TASKS[0]);
  const [tree, setTree] = useState<TaskTree | null>(null);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<RebranchResult[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const watcherRef = useRef<ReturnType<typeof createWatcher> | null>(null);

  // SSR-safe bootstrap.
  useEffect(() => {
    const initial = buildDemoContext();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCtx(initial);
  }, []);

  // (Re)create the watcher whenever the parent prompt changes.
  useEffect(() => {
    if (!ctx) return;
    let mounted = true;
    setRunning(true);
    const w = createWatcher({
      parentTask,
      getContext: () => ctx,
      options: { debounceMs: 100 },
    });
    watcherRef.current?.dispose();
    watcherRef.current = w;
    const unsub = w.subscribe((r) => {
      if (!mounted) return;
      setTree(w.getTree());
      setHistory((prev) => [r, ...prev].slice(0, 8));
    });
    w.flush().then((r) => {
      if (!mounted) return;
      setTree(w.getTree());
      if (r) setHistory((prev) => [r, ...prev].slice(0, 8));
      setRunning(false);
    });
    return () => {
      mounted = false;
      unsub();
      w.dispose();
    };
  }, [ctx, parentTask]);

  const intent = useMemo<ParsedIntent>(() => parseIntent(parentTask), [parentTask]);
  const subtasks = useMemo(() => {
    if (!tree) return [];
    const kids = tree.childrenOf.get(tree.rootId) ?? [];
    return kids.map((id) => tree.tasks.get(id)).filter((x): x is AtomicSubtask => !!x);
  }, [tree]);

  const selected = selectedTaskId && tree ? tree.tasks.get(selectedTaskId) : null;

  // Counts for the stat strip.
  const counts = useMemo(() => {
    const c: Record<TaskStatus, number> = {
      pending: 0, in_progress: 0, blocked: 0, complete: 0, irrelevant: 0, "user-locked": 0,
    };
    for (const t of subtasks) c[t.status]++;
    return c;
  }, [subtasks]);

  /* ── Mutators that prove the watcher works ── */

  function mutateAssertion(key: string, deltaPct: number) {
    if (!ctx || !watcherRef.current) return;
    const next: ProjectContext = {
      ...ctx,
      asOf: Date.now(),
      assertions: ctx.assertions.map((a) =>
        a.key === key && a.value.type === "number"
          ? { ...a, value: { ...a.value, value: Math.round(a.value.value * (1 + deltaPct)) }, sourcedAt: Date.now() }
          : a,
      ),
    };
    setCtx(next);
    const target = next.assertions.find((a) => a.key === key);
    if (target) {
      watcherRef.current.push({ kind: "assertion-upsert", assertionId: target.id, key });
    }
  }

  function deleteAssertion(key: string) {
    if (!ctx || !watcherRef.current) return;
    const target = ctx.assertions.find((a) => a.key === key);
    if (!target) return;
    setCtx({ ...ctx, assertions: ctx.assertions.filter((a) => a.key !== key), asOf: Date.now() });
    watcherRef.current.push({ kind: "assertion-delete", assertionId: target.id, key });
  }

  async function manualFlush() {
    if (!watcherRef.current) return;
    setRunning(true);
    await watcherRef.current.flush();
    setRunning(false);
  }

  function toggleUserLock(id: string) {
    if (!tree) return;
    const t = tree.tasks.get(id);
    if (!t) return;
    const newTree: TaskTree = {
      ...tree,
      tasks: new Map(tree.tasks).set(id, {
        ...t,
        userLocked: !t.userLocked,
        status: !t.userLocked ? "user-locked" : "pending",
        updatedAt: Date.now(),
      }),
    };
    setTree(newTree);
  }

  function commitTaskComplete(id: string) {
    if (!tree) return;
    const t = tree.tasks.get(id);
    if (!t) return;
    const newTree: TaskTree = {
      ...tree,
      tasks: new Map(tree.tasks).set(id, {
        ...t,
        status: "complete",
        userLocked: true,
        updatedAt: Date.now(),
      }),
    };
    setTree(newTree);
  }

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
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-2 flex items-center gap-2">
              <Network size={11} strokeWidth={1.75} />
              Lattice · state-to-action translator
            </p>
            <h1 className="font-display font-extrabold text-3xl sm:text-4xl text-foreground tracking-[-0.025em] leading-[1.05]">
              {counts.complete === subtasks.length && subtasks.length > 0 ? (
                <>Goal is <span className="text-green">compiled</span>.</>
              ) : counts.blocked > 0 ? (
                <><span className="text-rose">{counts.blocked} blocked</span>, {counts.pending + counts.in_progress} open.</>
              ) : (
                <><span className="text-violet">{subtasks.length}</span> atomic subtask{subtasks.length === 1 ? "" : "s"} generated.</>
              )}
            </h1>
            <p className="text-[13px] text-muted mt-2 max-w-2xl leading-relaxed">
              Type a goal. Lattice parses intent, cross-references the project state, and emits atomic subtasks bound to specific assertions and document sections. Mutate the data on the right — watch the tree re-decompose.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={manualFlush}
              disabled={running}
              className="flex items-center gap-2 border border-border text-foreground hover:border-violet hover:text-violet text-[11px] font-semibold uppercase tracking-[0.12em] px-4 py-2.5 transition-colors duration-150"
            >
              {running ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} strokeWidth={2.25} />}
              Re-decompose
            </button>
          </div>
        </div>

        {/* Prompt input */}
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <div className="flex-1 flex items-center gap-3 border border-border bg-background px-4 py-2.5 focus-within:border-violet transition-colors">
            <Sparkles size={12} className="text-violet shrink-0" />
            <input
              value={draftPrompt}
              onChange={(e) => setDraftPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && draftPrompt.trim()) setParentTask(draftPrompt.trim());
              }}
              placeholder="High-level goal — e.g. Hire 4 senior engineers by Q3"
              className="flex-1 bg-transparent outline-none text-[14px] font-medium placeholder:text-muted"
            />
          </div>
          <button
            onClick={() => setParentTask(draftPrompt.trim() || parentTask)}
            disabled={!draftPrompt.trim() || draftPrompt === parentTask}
            className="bg-violet text-white hover:bg-violet/90 disabled:opacity-50 text-[11px] font-semibold uppercase tracking-[0.12em] px-5 py-2.5 transition-colors duration-150 btn-glow-violet"
          >
            Decompose
          </button>
        </div>

        {/* Preset prompts */}
        <div className="flex flex-wrap gap-2">
          {DEMO_PARENT_TASKS.map((t) => (
            <button
              key={t}
              onClick={() => {
                setDraftPrompt(t);
                setParentTask(t);
              }}
              className={`text-[10px] uppercase tracking-[0.12em] font-semibold px-3 py-1.5 border transition-colors duration-150 ${
                parentTask === t ? "border-violet bg-violet text-white" : "border-border text-muted hover:border-violet hover:text-violet"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Stat strip */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-2">
          <Stat label="Open" value={counts.pending + counts.in_progress} tone="violet" />
          <Stat label="Complete" value={counts.complete} tone="green" />
          <Stat label="Blocked" value={counts.blocked} tone={counts.blocked ? "rose" : "green"} />
          <Stat label="User-locked" value={counts["user-locked"]} tone="cyan" />
          <Stat label="Irrelevant" value={counts.irrelevant} tone="warm" />
        </div>
      </motion.header>

      {/* Body */}
      <div className="grid grid-cols-12 gap-x-0">
        <div className="col-span-12 lg:col-span-8 px-6 sm:px-10 pb-16 lg:border-r lg:border-border">
          <section className="mt-8">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3 flex items-center gap-2">
              <GitBranch size={11} />
              Task tree · depth-1 fanout
            </p>
            {!tree ? (
              <div className="border border-border bg-surface py-16 text-center text-muted text-[14px]">Decomposing…</div>
            ) : subtasks.length === 0 ? (
              <div className="border border-border bg-surface py-16 text-center text-muted text-[14px]">No subtasks emitted.</div>
            ) : (
              <ul className="divide-y divide-border border-y border-border">
                {subtasks.map((task, i) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    index={i + 1}
                    onSelect={() => setSelectedTaskId(task.id)}
                    onToggleLock={() => toggleUserLock(task.id)}
                    onCommit={() => commitTaskComplete(task.id)}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="col-span-12 lg:col-span-4 px-6 sm:px-10 pt-8 pb-16 space-y-6">
          <IntentCard intent={intent} />
          <ContextMutator ctx={ctx} onShiftSalary={() => mutateAssertion("engineering.senior.salary", 0.4)} onDeleteRunway={() => deleteAssertion("runway.months")} onResetCtx={() => setCtx(buildDemoContext())} />
          <RebranchHistory history={history} />
          <PrincipleCard />
        </aside>
      </div>

      <AnimatePresence>
        {selected && <TaskDrawer task={selected} onClose={() => setSelectedTaskId(null)} />}
      </AnimatePresence>
    </div>
  );
}

/* ─────── building blocks ─────── */

function Stat({ label, value, tone }: { label: string; value: number; tone: "violet" | "rose" | "green" | "cyan" | "warm" }) {
  const accent =
    tone === "violet" ? "text-violet" :
    tone === "rose" ? "text-rose" :
    tone === "cyan" ? "text-cyan" :
    tone === "warm" ? "text-warm" : "text-green";
  const card =
    tone === "rose" ? "stat-card-rose" :
    tone === "warm" ? "stat-card-warm" :
    tone === "cyan" ? "stat-card-cyan" : "stat-card-green";
  return (
    <div className={`${card} p-3.5`}>
      <p className="text-[10px] uppercase tracking-[0.15em] text-muted font-medium">{label}</p>
      <p className={`font-display font-extrabold text-2xl tabular-nums tracking-[-0.02em] mt-1 ${accent}`}>{value}</p>
    </div>
  );
}

function TaskRow({ task, index, onSelect, onToggleLock, onCommit }: {
  task: AtomicSubtask;
  index: number;
  onSelect: () => void;
  onToggleLock: () => void;
  onCommit: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const meta = STATUS_META[task.status];
  const Icon = meta.icon;
  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.02, ease }}
      className={`py-4 ${task.status === "irrelevant" ? "opacity-55" : ""}`}
    >
      <div className="flex items-start gap-4">
        <span className="font-display font-bold text-muted text-[13px] tabular-nums tracking-tight pt-0.5 shrink-0 w-8">
          {String(index).padStart(2, "0")}
        </span>
        <button onClick={() => setExpanded((v) => !v)} className="mt-0.5 text-muted hover:text-foreground transition-colors" aria-label="Toggle">
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] font-semibold ${meta.tone}`}>
              <Icon size={11} strokeWidth={2.25} />
              {meta.label}
            </span>
            {task.intentTag && (
              <>
                <span className="text-[10px] text-muted">·</span>
                <span className="text-[10px] uppercase tracking-[0.12em] text-cyan font-medium">{task.intentTag}</span>
              </>
            )}
            {task.draftOutcome && (
              <>
                <span className="text-[10px] text-muted">·</span>
                <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium">draft {Math.round(task.draftOutcome.confidence * 100)}%</span>
              </>
            )}
          </div>
          <button onClick={onSelect} className="text-left mt-1 font-display font-bold text-foreground text-[16px] sm:text-[17px] tracking-[-0.018em] leading-tight hover:text-violet transition-colors">
            {task.title}
          </button>
          {task.description && <p className="text-[12.5px] text-muted leading-relaxed mt-1">{task.description}</p>}

          {/* Bindings */}
          {(task.boundAssertionKeys.length > 0 || task.boundDocumentIds.length > 0) && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {task.boundAssertionKeys.map((k) => (
                <span key={k} className="text-[10px] uppercase tracking-[0.1em] font-medium border border-border bg-surface text-foreground px-2 py-0.5 inline-flex items-center gap-1">
                  <Cpu size={9} /> {k}
                </span>
              ))}
              {task.boundDocumentIds.map((d) => (
                <span key={d} className="text-[10px] uppercase tracking-[0.1em] font-medium border border-border bg-surface text-muted px-2 py-0.5 inline-flex items-center gap-1">
                  <FileText size={9} /> {d}
                </span>
              ))}
            </div>
          )}

          {expanded && (
            <div className="mt-3 border-t border-border pt-3 space-y-3">
              <ConditionView condition={task.resolutionCondition} />
              {task.draftOutcome && (
                <div className="border border-border bg-surface p-3">
                  <p className="text-[10px] uppercase tracking-[0.15em] text-violet font-semibold mb-1.5 flex items-center gap-1.5">
                    <Eye size={10} /> Pre-computed draft
                  </p>
                  <pre className="text-[12px] text-foreground leading-relaxed whitespace-pre-wrap font-sans">{task.draftOutcome.body}</pre>
                  {task.draftOutcome.writes.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {task.draftOutcome.writes.map((w) => (
                        <div key={w.key} className="text-[11px] text-muted flex items-center gap-2">
                          <CheckSquare size={10} className="text-violet" />
                          <span className="font-mono">{w.key}</span>
                          <span>=</span>
                          <span className="font-mono text-foreground">{formatValue(w.value)}</span>
                          <span className="text-[10px] uppercase tracking-[0.12em]">· {Math.round(w.confidence * 100)}%</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {task.draftOutcome.caveats.length > 0 && (
                    <ul className="mt-2 space-y-0.5">
                      {task.draftOutcome.caveats.map((c, i) => (
                        <li key={i} className="text-[11px] text-warm">⚠ {c}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onCommit}
            title="Verify & Commit"
            className="border border-border w-7 h-7 flex items-center justify-center text-muted hover:text-green hover:border-green transition-colors"
          >
            <CheckCircle2 size={12} />
          </button>
          <button
            onClick={onToggleLock}
            title={task.userLocked ? "Unlock" : "Lock"}
            className={`border w-7 h-7 flex items-center justify-center transition-colors ${task.userLocked ? "border-cyan text-cyan" : "border-border text-muted hover:text-cyan hover:border-cyan"}`}
          >
            <Lock size={11} />
          </button>
        </div>
      </div>
    </motion.li>
  );
}

function ConditionView({ condition }: { condition: ResolutionCondition }) {
  return (
    <div className="text-[12px] leading-relaxed">
      <p className="text-[10px] uppercase tracking-[0.15em] text-muted font-semibold mb-1.5 flex items-center gap-1.5">
        <Hourglass size={10} /> Resolution condition
      </p>
      <ConditionTree condition={condition} depth={0} />
    </div>
  );
}

function ConditionTree({ condition, depth }: { condition: ResolutionCondition; depth: number }) {
  const indent = { paddingLeft: depth * 12 };
  switch (condition.kind) {
    case "assertion-exists":
      return <p style={indent} className="text-foreground"><span className="text-cyan">exists</span> <code className="text-[11px]">{condition.assertionKey}</code></p>;
    case "assertion-fresh":
      return <p style={indent} className="text-foreground"><span className="text-cyan">fresh</span> <code className="text-[11px]">{condition.assertionKey}</code> {condition.minTrust ? `≥ ${(condition.minTrust * 100).toFixed(0)}%` : ""}{condition.maxAgeDays ? ` · ≤ ${condition.maxAgeDays}d` : ""}</p>;
    case "assertion-value":
      return <p style={indent} className="text-foreground"><span className="text-cyan">value</span> <code className="text-[11px]">{condition.assertionKey}</code> {condition.range ? `${condition.range.min ?? "·"} … ${condition.range.max ?? "·"}` : ""}</p>;
    case "document-section":
      return <p style={indent} className="text-foreground"><span className="text-cyan">section</span> <code className="text-[11px]">{condition.documentId}</code> contains heading "{condition.headingMatches}"</p>;
    case "document-mentions":
      return <p style={indent} className="text-foreground"><span className="text-cyan">mentions</span> <code className="text-[11px]">{condition.documentId}</code> matches /{condition.pattern}/</p>;
    case "task-complete":
      return <p style={indent} className="text-foreground"><span className="text-cyan">task</span> {condition.taskId} complete</p>;
    case "manual":
      return <p style={indent} className="text-muted italic">{condition.hint ?? "manual confirmation required"}</p>;
    case "and":
      return (
        <div>
          <p style={indent} className="text-violet text-[10px] uppercase tracking-[0.12em] font-semibold">AND</p>
          {condition.conditions.map((c, i) => <ConditionTree key={i} condition={c} depth={depth + 1} />)}
        </div>
      );
    case "or":
      return (
        <div>
          <p style={indent} className="text-violet text-[10px] uppercase tracking-[0.12em] font-semibold">OR</p>
          {condition.conditions.map((c, i) => <ConditionTree key={i} condition={c} depth={depth + 1} />)}
        </div>
      );
  }
}

function IntentCard({ intent }: { intent: ParsedIntent }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.08, ease }}
      className="border border-border bg-foreground text-background p-5 relative overflow-hidden"
    >
      <span aria-hidden className="absolute top-0 left-0 w-[2px] h-full bg-violet" />
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={12} strokeWidth={2.25} className="text-violet" />
        <span className="text-[10px] uppercase tracking-[0.18em] text-background/60 font-medium">Parsed intent</span>
      </div>
      <div className="space-y-2 text-[12.5px]">
        <Row k="Kind" v={intent.kind} />
        <Row k="Verb" v={intent.verb || "—"} />
        <Row k="Object" v={intent.object || "—"} />
        <Row k="Quantity" v={intent.quantity != null ? String(intent.quantity) : "—"} />
        <Row k="By date" v={intent.byDate ?? "—"} />
        <Row k="Confidence" v={`${Math.round(intent.confidence * 100)}%`} />
      </div>
      {intent.unresolved.length > 0 && (
        <ul className="mt-3 space-y-0.5">
          {intent.unresolved.map((u, i) => (
            <li key={i} className="text-[11px] text-warm">⚠ {u}</li>
          ))}
        </ul>
      )}
    </motion.div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-background/55 text-[10px] uppercase tracking-[0.12em] font-medium">{k}</span>
      <span className="text-background tabular-nums truncate">{v}</span>
    </div>
  );
}

function ContextMutator({ ctx, onShiftSalary, onDeleteRunway, onResetCtx }: {
  ctx: ProjectContext | null;
  onShiftSalary: () => void;
  onDeleteRunway: () => void;
  onResetCtx: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.16, ease }}
    >
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">Mutate project · watch rebranch</p>
      <div className="border border-border bg-surface divide-y divide-border">
        <MutatorRow
          title="Shift senior salary +40%"
          subtitle="Triggers rebranch of comp-bound subtasks."
          onClick={onShiftSalary}
          disabled={!ctx}
        />
        <MutatorRow
          title="Delete runway assertion"
          subtitle="Causes the runway-check subtask to revert to pending."
          onClick={onDeleteRunway}
          disabled={!ctx}
        />
        <MutatorRow
          title="Reset context"
          subtitle="Restores the demo data."
          onClick={onResetCtx}
        />
      </div>
    </motion.div>
  );
}

function MutatorRow({ title, subtitle, onClick, disabled }: { title: string; subtitle: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="block w-full text-left px-4 py-3 hover:bg-violet/[0.06] disabled:opacity-50 transition-colors"
    >
      <div className="text-[12.5px] font-medium text-foreground">{title}</div>
      <div className="text-[11px] text-muted">{subtitle}</div>
    </button>
  );
}

function RebranchHistory({ history }: { history: RebranchResult[] }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.24, ease }}
    >
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">Rebranch log</p>
      <div className="border border-border bg-surface">
        {history.length === 0 ? (
          <div className="px-4 py-5 text-center text-[12px] text-muted">No rebranches yet.</div>
        ) : history.map((r, i) => (
          <div key={i} className="px-4 py-3 border-b last:border-b-0 border-border">
            <div className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums mb-1">
              {new Date(r.ranAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}
            </div>
            <div className="text-[12px] flex flex-wrap gap-x-3 gap-y-0.5">
              {r.added.length > 0 && <span className="text-green">+{r.added.length} added</span>}
              {r.removed.length > 0 && <span className="text-rose">-{r.removed.length} removed</span>}
              {r.statusChanged.length > 0 && <span className="text-violet">{r.statusChanged.length} status</span>}
              {r.draftsRefreshed.length > 0 && <span className="text-cyan">{r.draftsRefreshed.length} drafts</span>}
              {r.blocked.length > 0 && <span className="text-warm">{r.blocked.length} blocked</span>}
              {r.added.length === 0 && r.removed.length === 0 && r.statusChanged.length === 0 && r.draftsRefreshed.length === 0 && (
                <span className="text-muted">no-op</span>
              )}
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
      transition={{ duration: 0.3, delay: 0.32, ease }}
      className="border border-border bg-foreground text-background p-5 relative overflow-hidden"
    >
      <span aria-hidden className="absolute top-0 left-0 w-[2px] h-full bg-cyan" />
      <div className="flex items-center gap-2 mb-3">
        <Network size={12} strokeWidth={2} className="text-cyan" />
        <span className="text-[10px] uppercase tracking-[0.18em] text-background/60 font-medium">The principle</span>
      </div>
      <h3 className="font-display font-bold text-[18px] tracking-[-0.018em] leading-[1.2] mb-3">
        Tasks aren&apos;t a list. They&apos;re a <span className="text-cyan">function of state</span>.
      </h3>
      <p className="text-[13px] text-background/70 leading-relaxed">
        Change the data and the task tree changes with it. Done-ness is a query against the project, not a checkbox.
      </p>
    </motion.div>
  );
}

function TaskDrawer({ task, onClose }: { task: AtomicSubtask; onClose: () => void }) {
  const meta = STATUS_META[task.status];
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-foreground/30 z-40 flex items-end sm:items-center sm:justify-end"
      onClick={onClose}
    >
      <motion.div
        initial={{ x: 32, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 32, opacity: 0 }}
        transition={{ duration: 0.25, ease }}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-background border-l border-border min-h-[60vh] sm:min-h-screen shadow-[0_30px_80px_-30px_rgba(0,0,0,0.45)]"
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 ${meta.bg}`} />
            <span className={`text-[10px] uppercase tracking-[0.18em] font-semibold ${meta.tone}`}>{meta.label}</span>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center text-muted hover:text-foreground" aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div className="px-5 py-5 space-y-4 overflow-y-auto max-h-[calc(100vh-72px)]">
          <h2 className="font-display font-bold text-[22px] tracking-[-0.022em] leading-[1.15] text-foreground">{task.title}</h2>
          {task.description && <p className="text-[13px] text-foreground leading-relaxed">{task.description}</p>}
          <div className="border-t border-border pt-4">
            <ConditionView condition={task.resolutionCondition} />
          </div>
          {task.draftOutcome && (
            <div className="border border-border bg-surface p-3">
              <p className="text-[10px] uppercase tracking-[0.15em] text-violet font-semibold mb-1.5 flex items-center gap-1.5">
                <Eye size={10} /> Draft outcome · {Math.round(task.draftOutcome.confidence * 100)}%
              </p>
              <pre className="text-[12px] text-foreground leading-relaxed whitespace-pre-wrap font-sans">{task.draftOutcome.body}</pre>
            </div>
          )}
          <div className="border-t border-border pt-4">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-semibold mb-2">History · last {Math.min(task.history.length, 5)} of {task.history.length}</p>
            <ol className="space-y-1.5">
              {task.history.slice(-5).reverse().map((h, i) => (
                <li key={i} className="text-[11.5px] text-muted">
                  <span className="tabular-nums">{new Date(h.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                  {" · "}
                  <span className="text-foreground">{h.status}</span>
                  {" · "}
                  <span>{h.by}</span>
                  {h.reason ? ` — ${h.reason}` : ""}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function formatValue(v: AtomicSubtask["draftOutcome"] extends infer T ? T extends { writes: infer W } ? W extends Array<infer Item> ? Item extends { value: infer V } ? V : never : never : never : never): string {
  if (!v) return "—";
  switch (v.type) {
    case "number": return `${v.value.toLocaleString()}${v.unit ? " " + v.unit : ""}`;
    case "string": return `"${v.value}"`;
    case "boolean": return v.value ? "true" : "false";
    case "date": return v.value;
  }
}

// resolveTree is exported but we don't call it directly here — the
// watcher handles resolution internally. Suppress the unused warning at
// the import level by referencing it once:
void resolveTree;
