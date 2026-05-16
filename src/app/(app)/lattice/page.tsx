"use client";

/**
 * Lattice — recursive task decomposition.
 *
 * Editorial sub-nav layout (matches Sync/Pulse density):
 *   • Overview  — parser intent + rebranch log + principle card
 *   • Subtasks  — the task tree (indented, recursively decomposable)
 *   • Drafts    — pre-computed draft outcomes (table view per row)
 *   • Watcher   — context mutator panel + rebranch history
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
  Hourglass,
  CheckSquare,
  X,
  GitBranch,
  History,
  FlaskConical,
  Layers,
  Radio,
} from "lucide-react";
import {
  buildDemoContext,
  DEMO_PARENT_TASKS,
  MAX_TREE_DEPTH,
  createWatcher,
  decomposeSubtask,
  parseIntent,
  reconcile,
  resolveTree,
  subscribeTree,
  writeTree,
  type AtomicSubtask,
  type DraftAssertionWrite,
  type ParsedIntent,
  type ProjectContext,
  type RebranchResult,
  type ResolutionCondition,
  type TaskId,
  type TaskStatus,
  type TaskTree,
} from "@/lib/lattice";
import { useAuth } from "@/context/AuthContext";
import { useRegisterCommandSource, makeCommandId, type CommandItem } from "@/hooks/useCommandPalette";
import { recordActivity } from "@/lib/activity";

const ease = [0.22, 0.61, 0.36, 1] as const;

const STATUS_META: Record<TaskStatus, { label: string; tone: string; bg: string; icon: typeof CheckCircle2 }> = {
  pending:     { label: "Pending",     tone: "text-muted",  bg: "bg-muted",  icon: Circle },
  in_progress: { label: "In progress", tone: "text-violet", bg: "bg-violet", icon: CirclePause },
  blocked:     { label: "Blocked",     tone: "text-rose",   bg: "bg-rose",   icon: CircleAlert },
  complete:    { label: "Complete",    tone: "text-green",  bg: "bg-green",  icon: CheckCircle2 },
  irrelevant:  { label: "Irrelevant",  tone: "text-muted",  bg: "bg-muted",  icon: CircleSlash },
  "user-locked": { label: "Locked",    tone: "text-cyan",   bg: "bg-cyan",   icon: Lock },
};

type Tab = "overview" | "subtasks" | "drafts" | "watcher";
const TABS: { key: Tab; label: string; icon: typeof Network }[] = [
  { key: "overview", label: "Overview", icon: Sparkles },
  { key: "subtasks", label: "Subtasks", icon: Layers },
  { key: "drafts",   label: "Drafts",   icon: FlaskConical },
  { key: "watcher",  label: "Watcher",  icon: History },
];

// Demo project id used when the user is unauthenticated; live mirror
// only kicks in for the real authed project.
const DEMO_PROJECT_ID = "demo-project";

export default function LatticePage() {
  const { user } = useAuth();
  const [ctx, setCtx] = useState<ProjectContext | null>(null);
  const [parentTask, setParentTask] = useState<string>(DEMO_PARENT_TASKS[0]);
  const [draftPrompt, setDraftPrompt] = useState<string>(DEMO_PARENT_TASKS[0]);
  const [tree, setTree] = useState<TaskTree | null>(null);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<RebranchResult[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [liveSubscribed, setLiveSubscribed] = useState(false);
  const watcherRef = useRef<ReturnType<typeof createWatcher> | null>(null);
  // Stable refs so the subscribe/write effect can see the latest tree
  // without re-subscribing on every change.
  const treeRef = useRef<TaskTree | null>(null);
  useEffect(() => { treeRef.current = tree; }, [tree]);
  // Watermark for echo suppression — never mirror back a tree we
  // already wrote with the same `updatedAt`.
  const lastWrittenAtRef = useRef<number>(0);
  // Watermark of the most recent remote snapshot — used to skip mirror
  // writes that arrive purely from a remote echo.
  const lastRemoteAtRef = useRef<number>(0);

  useEffect(() => {
    const initial = buildDemoContext();
    setCtx(initial);
  }, []);

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
      setHistory((prev) => [r, ...prev].slice(0, 16));
      recordActivity({
        source: "lattice",
        kind: "lattice.rebranch",
        title: "Lattice · rebranched",
        summary: `+${r.added.length} added · -${r.removed.length} removed · ${r.statusChanged.length} status`,
        projectId: ctx?.projectId,
        uid: user?.uid,
        detail: { added: r.added.length, removed: r.removed.length, statusChanged: r.statusChanged.length, draftsRefreshed: r.draftsRefreshed.length, blocked: r.blocked.length },
      });
    });
    w.flush().then((r) => {
      if (!mounted) return;
      setTree(w.getTree());
      if (r) setHistory((prev) => [r, ...prev].slice(0, 16));
      setRunning(false);
    });
    return () => {
      mounted = false;
      unsub();
      w.dispose();
    };
    // user is captured by closure for the activity log only; we don't
    // want to recreate the watcher on login/logout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, parentTask]);

  // ── Live Firestore subscription (TASK 6) ──
  // Subscribes once we have an authed user + a tree to anchor against.
  // Reconciles remote subtasks back into the in-memory tree via
  // last-write-wins per row.
  useEffect(() => {
    if (!user || !tree) return;
    let active = true;
    const opts = { uid: user.uid, projectId: DEMO_PROJECT_ID, rootId: tree.rootId };
    const unsub = subscribeTree({
      ...opts,
      onTree: (remote) => {
        if (!active) return;
        const local = treeRef.current;
        lastRemoteAtRef.current = remote.updatedAt;
        if (!local) {
          setTree(remote);
          return;
        }
        const merged = reconcile(local, remote);
        // Only setTree if the reconciled tree differs in some way.
        if (merged !== local) setTree(merged);
      },
      onError: (err) => {
        console.warn("[lattice] live subscribe failed:", err);
      },
    });
    setLiveSubscribed(true);
    return () => {
      active = false;
      unsub();
      setLiveSubscribed(false);
    };
    // We deliberately subscribe per-rootId, not per-tree, so a local
    // tree mutation doesn't tear down and recreate the listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, tree?.rootId]);

  // ── Best-effort mirror writes (TASK 6) ──
  // Whenever the tree updates locally, push it to Firestore. Throttled
  // implicitly by React batching; the writeTree helper chunks into
  // ≤450-op batches if the tree ever grows past that.
  //
  // Echo suppression: if `tree.updatedAt` equals the most recent remote
  // snapshot we just received (or matches what we last wrote), skip
  // the round-trip to avoid an infinite subscribe→write→subscribe loop.
  useEffect(() => {
    if (!user || !tree) return;
    if (tree.updatedAt <= lastRemoteAtRef.current) return;
    if (tree.updatedAt === lastWrittenAtRef.current) return;
    lastWrittenAtRef.current = tree.updatedAt;
    writeTree(tree, { uid: user.uid, projectId: DEMO_PROJECT_ID }).catch((err) => {
      console.warn("[lattice] mirror write failed:", err);
    });
  }, [user, tree]);

  const intent = useMemo<ParsedIntent>(() => parseIntent(parentTask), [parentTask]);

  // Top-level children of the root, in declared order.
  const topLevelSubtasks = useMemo(() => {
    if (!tree) return [];
    const kids = tree.childrenOf.get(tree.rootId) ?? [];
    return kids.map((id) => tree.tasks.get(id)).filter((x): x is AtomicSubtask => !!x);
  }, [tree]);

  // Flat list of every task for the drafts table.
  const allTasksWithDrafts = useMemo(() => {
    if (!tree) return [];
    return Array.from(tree.tasks.values()).filter((t) => !!t.draftOutcome && t.status !== "irrelevant");
  }, [tree]);

  const selected = selectedTaskId && tree ? tree.tasks.get(selectedTaskId) : null;

  const counts = useMemo(() => {
    const c: Record<TaskStatus, number> = {
      pending: 0, in_progress: 0, blocked: 0, complete: 0, irrelevant: 0, "user-locked": 0,
    };
    for (const t of topLevelSubtasks) c[t.status]++;
    return c;
  }, [topLevelSubtasks]);

  // Surface every non-irrelevant subtask in the command palette.
  const taskCommands = useMemo<CommandItem[]>(() => {
    if (!tree) return [];
    return Array.from(tree.tasks.values())
      .filter((t) => t.status !== "irrelevant" && t.parentId != null)
      .map((t) => ({
        id: makeCommandId("lattice.task", t.id),
        kind: "lattice-task" as const,
        label: t.title,
        subtitle: `${t.status} · depth ${t.depth}${t.intentTag ? ` · ${t.intentTag}` : ""}`,
        keywords: [
          ...t.boundAssertionKeys,
          ...t.boundDocumentIds,
          t.intentTag ?? "",
          t.description ?? "",
        ],
        href: "/lattice",
        anchor: `task-${t.id}`,
      }));
  }, [tree]);
  useRegisterCommandSource("lattice.tasks", taskCommands);

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

  function toggleUserLock(id: TaskId) {
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

  function commitTaskComplete(id: TaskId) {
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
      {/* ───────── Header ───────── */}
      <motion.header
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease }}
        className="px-6 sm:px-10 pt-10 pb-6 flex flex-col gap-6"
      >
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div className="max-w-2xl">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-2 flex items-center gap-2">
              <Network size={11} strokeWidth={1.75} />
              Lattice · state-to-action translator
            </p>
            <h1 className="font-display font-extrabold text-3xl sm:text-4xl text-foreground tracking-[-0.025em] leading-[1.05]">
              {counts.complete === topLevelSubtasks.length && topLevelSubtasks.length > 0 ? (
                <>Goal is <span className="text-green">compiled</span>.</>
              ) : counts.blocked > 0 ? (
                <><span className="text-rose">{counts.blocked} blocked</span>, {counts.pending + counts.in_progress} open.</>
              ) : (
                <><span className="text-violet">{topLevelSubtasks.length}</span> atomic subtask{topLevelSubtasks.length === 1 ? "" : "s"} generated.</>
              )}
            </h1>
            <p className="text-[13px] text-muted mt-3 leading-relaxed">
              Type a goal. Lattice parses intent, cross-references project state, and emits atomic subtasks bound to specific assertions and document sections. Mutate the data in the Watcher tab — watch the tree re-decompose.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {liveSubscribed && (
              <span
                className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] font-semibold text-green border border-green/30 bg-green/[0.06] px-3 py-1.5"
                title="Subscribed to remote tree changes"
              >
                <Radio size={10} strokeWidth={2.25} className="animate-pulse" />
                Live
              </span>
            )}
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

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-2">
          <Stat label="Open" value={counts.pending + counts.in_progress} tone="violet" />
          <Stat label="Complete" value={counts.complete} tone="green" />
          <Stat label="Blocked" value={counts.blocked} tone={counts.blocked ? "rose" : "green"} />
          <Stat label="User-locked" value={counts["user-locked"]} tone="cyan" />
          <Stat label="Irrelevant" value={counts.irrelevant} tone="warm" />
        </div>
      </motion.header>

      {/* ───────── Sub-nav ───────── */}
      <div className="border-y border-border bg-background sticky top-0 z-10">
        <div className="px-6 sm:px-10 flex items-center">
          {TABS.map((t) => {
            const active = tab === t.key;
            const Icon = t.icon;
            const badge =
              t.key === "subtasks" ? topLevelSubtasks.length :
              t.key === "drafts" ? allTasksWithDrafts.length :
              t.key === "watcher" ? history.length : null;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`relative text-[11px] uppercase tracking-[0.14em] font-semibold px-4 py-3 transition-colors duration-150 ${active ? "text-foreground" : "text-muted hover:text-foreground"}`}
                aria-current={active ? "page" : undefined}
              >
                <span className="inline-flex items-center gap-2">
                  <Icon size={11} strokeWidth={1.75} />
                  {t.label}
                  {badge !== null && (
                    <span className={`text-[10px] tabular-nums px-1.5 py-0.5 ${active ? "bg-violet text-white" : "bg-surface-light text-muted"}`}>
                      {badge}
                    </span>
                  )}
                </span>
                {active && (
                  <motion.span
                    layoutId="lattice-tab-indicator"
                    transition={{ duration: 0.22, ease }}
                    className="absolute left-0 right-0 -bottom-px h-[2px] bg-violet"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ───────── Tab content ───────── */}
      <div className="px-6 sm:px-10 pt-8 pb-16">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.22, ease }}
          >
            {tab === "overview" && (
              <OverviewPanel intent={intent} history={history} parentTask={parentTask} />
            )}
            {tab === "subtasks" && (
              <SubtasksPanel
                tree={tree}
                topLevelSubtasks={topLevelSubtasks}
                onSelect={(id) => setSelectedTaskId(id)}
                onToggleLock={toggleUserLock}
                onCommit={commitTaskComplete}
                ctx={ctx}
                onTreeChange={(t) => setTree(t)}
              />
            )}
            {tab === "drafts" && (
              <DraftsPanel
                tree={tree}
                tasks={allTasksWithDrafts}
                onSelect={(id) => setSelectedTaskId(id)}
                onCommit={commitTaskComplete}
              />
            )}
            {tab === "watcher" && (
              <WatcherPanel
                ctx={ctx}
                history={history}
                onShiftSalary={() => mutateAssertion("engineering.senior.salary", 0.4)}
                onDeleteRunway={() => deleteAssertion("runway.months")}
                onResetCtx={() => setCtx(buildDemoContext())}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {selected && <TaskDrawer task={selected} onClose={() => setSelectedTaskId(null)} />}
      </AnimatePresence>
    </div>
  );
}

/* ─────── Overview tab ─────── */

function OverviewPanel({ intent, history, parentTask }: { intent: ParsedIntent; history: RebranchResult[]; parentTask: string }) {
  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <IntentCard intent={intent} parentTask={parentTask} />
        <RebranchSummary history={history} />
      </div>
      <PrincipleCard />
    </div>
  );
}

function IntentCard({ intent, parentTask }: { intent: ParsedIntent; parentTask: string }) {
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
      <p className="text-[13px] text-background/80 leading-relaxed mb-3">{parentTask}</p>
      <div className="space-y-1.5 text-[12.5px]">
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

function RebranchSummary({ history }: { history: RebranchResult[] }) {
  const last = history[0];
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.12, ease }}
      className="border border-border bg-surface p-5 relative overflow-hidden"
    >
      <span aria-hidden className="absolute top-0 left-0 w-[2px] h-full bg-cyan" />
      <div className="flex items-center gap-2 mb-3">
        <History size={12} strokeWidth={2} className="text-cyan" />
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium">Latest rebranch</span>
      </div>
      {!last ? (
        <p className="text-[13px] text-muted">No rebranches yet — push a mutator from the Watcher tab.</p>
      ) : (
        <>
          <p className="text-[13px] text-foreground leading-relaxed mb-3 tabular-nums">
            Ran {new Date(last.ranAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}
          </p>
          <div className="text-[12px] flex flex-wrap gap-x-3 gap-y-1">
            {last.added.length > 0 && <span className="text-green">+{last.added.length} added</span>}
            {last.removed.length > 0 && <span className="text-rose">-{last.removed.length} removed</span>}
            {last.statusChanged.length > 0 && <span className="text-violet">{last.statusChanged.length} status</span>}
            {last.draftsRefreshed.length > 0 && <span className="text-cyan">{last.draftsRefreshed.length} drafts</span>}
            {last.blocked.length > 0 && <span className="text-warm">{last.blocked.length} blocked</span>}
            {last.added.length === 0 && last.removed.length === 0 && last.statusChanged.length === 0 && last.draftsRefreshed.length === 0 && (
              <span className="text-muted">no-op</span>
            )}
          </div>
        </>
      )}
    </motion.div>
  );
}

function PrincipleCard() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.18, ease }}
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

/* ─────── Subtasks tab ─────── */

function SubtasksPanel({
  tree,
  topLevelSubtasks,
  onSelect,
  onToggleLock,
  onCommit,
  ctx,
  onTreeChange,
}: {
  tree: TaskTree | null;
  topLevelSubtasks: AtomicSubtask[];
  onSelect: (id: TaskId) => void;
  onToggleLock: (id: TaskId) => void;
  onCommit: (id: TaskId) => void;
  ctx: ProjectContext | null;
  onTreeChange: (next: TaskTree) => void;
}) {
  return (
    <div className="max-w-5xl mx-auto">
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3 flex items-center gap-2">
        <GitBranch size={11} />
        Task tree · {topLevelSubtasks.length} top-level subtask{topLevelSubtasks.length === 1 ? "" : "s"}
      </p>
      {!tree ? (
        <div className="border border-border bg-surface py-16 text-center text-muted text-[14px]">Decomposing…</div>
      ) : topLevelSubtasks.length === 0 ? (
        <div className="border border-border bg-surface py-16 text-center text-muted text-[14px]">No subtasks emitted.</div>
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {topLevelSubtasks.map((task, i) => (
            <TaskRow
              key={task.id}
              task={task}
              index={i + 1}
              depth={0}
              tree={tree}
              ctx={ctx}
              onSelect={onSelect}
              onToggleLock={onToggleLock}
              onCommit={onCommit}
              onTreeChange={onTreeChange}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/* ─────── Drafts tab ─────── */

function DraftsPanel({
  tree,
  tasks,
  onSelect,
  onCommit,
}: {
  tree: TaskTree | null;
  tasks: AtomicSubtask[];
  onSelect: (id: TaskId) => void;
  onCommit: (id: TaskId) => void;
}) {
  if (!tree) return <div className="border border-border bg-surface py-16 text-center text-muted text-[14px]">No drafts yet.</div>;
  if (tasks.length === 0) {
    return (
      <div className="max-w-5xl mx-auto border border-border bg-surface py-16 text-center">
        <FlaskConical size={20} className="mx-auto text-muted mb-2" strokeWidth={1.5} />
        <p className="text-[13px] text-muted">No draft outcomes — Lattice couldn&apos;t synthesise commitable writes from the current context.</p>
      </div>
    );
  }
  return (
    <div className="max-w-5xl mx-auto">
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3 flex items-center gap-2">
        <FlaskConical size={11} />
        Pre-computed drafts · {tasks.length} commitable outcome{tasks.length === 1 ? "" : "s"}
      </p>
      <div className="border border-border overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead className="bg-surface text-muted">
            <tr className="text-left">
              <th className="px-4 py-2.5 font-medium text-[10px] uppercase tracking-[0.12em]">Subtask</th>
              <th className="px-4 py-2.5 font-medium text-[10px] uppercase tracking-[0.12em]">Writes</th>
              <th className="px-4 py-2.5 font-medium text-[10px] uppercase tracking-[0.12em]">Confidence</th>
              <th className="px-4 py-2.5 font-medium text-[10px] uppercase tracking-[0.12em]">Caveats</th>
              <th className="px-4 py-2.5 font-medium text-[10px] uppercase tracking-[0.12em]" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-background">
            {tasks.map((t) => {
              const d = t.draftOutcome!;
              return (
                <tr key={t.id} className="hover:bg-violet/[0.04]">
                  <td className="px-4 py-3 align-top">
                    <button onClick={() => onSelect(t.id)} className="text-foreground font-medium hover:text-violet text-left">
                      {t.title}
                    </button>
                    {t.intentTag && <div className="text-[10px] uppercase tracking-[0.12em] text-cyan mt-0.5">{t.intentTag}</div>}
                  </td>
                  <td className="px-4 py-3 align-top">
                    {d.writes.length === 0 ? (
                      <span className="text-muted text-[11px]">—</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {d.writes.map((w) => (
                          <li key={w.key} className="text-[11px] text-muted">
                            <code className="text-foreground">{w.key}</code> = <code>{formatValue(w.value)}</code>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top tabular-nums text-[12px]">
                    {Math.round(d.confidence * 100)}%
                  </td>
                  <td className="px-4 py-3 align-top">
                    {d.caveats.length === 0 ? (
                      <span className="text-muted text-[11px]">none</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {d.caveats.map((c, i) => (
                          <li key={i} className="text-[11px] text-warm">⚠ {c}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => onSelect(t.id)}
                        className="border border-border w-7 h-7 flex items-center justify-center text-muted hover:text-violet hover:border-violet transition-colors"
                        title="View"
                      >
                        <Eye size={11} />
                      </button>
                      <button
                        onClick={() => onCommit(t.id)}
                        className="border border-border w-7 h-7 flex items-center justify-center text-muted hover:text-green hover:border-green transition-colors"
                        title="Verify & Commit"
                      >
                        <CheckCircle2 size={11} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─────── Watcher tab ─────── */

function WatcherPanel({
  ctx,
  history,
  onShiftSalary,
  onDeleteRunway,
  onResetCtx,
}: {
  ctx: ProjectContext | null;
  history: RebranchResult[];
  onShiftSalary: () => void;
  onDeleteRunway: () => void;
  onResetCtx: () => void;
}) {
  return (
    <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div>
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
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3 flex items-center gap-2">
          <History size={11} />
          Rebranch history · last {history.length}
        </p>
        <div className="border border-border bg-surface max-h-[480px] overflow-y-auto">
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
      </div>
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

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-background/55 text-[10px] uppercase tracking-[0.12em] font-medium">{k}</span>
      <span className="text-background tabular-nums truncate">{v}</span>
    </div>
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

/* ─────── TaskRow ─────── */

function TaskRow({
  task, index, depth, tree, ctx,
  onSelect, onToggleLock, onCommit, onTreeChange,
}: {
  task: AtomicSubtask;
  index: number;
  depth: number;
  tree: TaskTree;
  ctx: ProjectContext | null;
  onSelect: (id: TaskId) => void;
  onToggleLock: (id: TaskId) => void;
  onCommit: (id: TaskId) => void;
  onTreeChange: (next: TaskTree) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const meta = STATUS_META[task.status];
  const Icon = meta.icon;
  const children = (tree.childrenOf.get(task.id) ?? [])
    .map((id) => tree.tasks.get(id))
    .filter((x): x is AtomicSubtask => !!x);

  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: Math.min(index, 12) * 0.015, ease }}
      className={`py-4 ${task.status === "irrelevant" ? "opacity-55" : ""}`}
    >
      <div className="flex items-start gap-4" style={{ paddingLeft: depth * 24 }}>
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
            {children.length > 0 && (
              <>
                <span className="text-[10px] text-muted">·</span>
                <span className="text-[10px] uppercase tracking-[0.12em] text-violet font-medium">{children.length} sub-subtasks</span>
              </>
            )}
          </div>
          <button onClick={() => onSelect(task.id)} className="text-left mt-1 font-display font-bold text-foreground text-[16px] sm:text-[17px] tracking-[-0.018em] leading-tight hover:text-violet transition-colors">
            {task.title}
          </button>
          {task.description && <p className="text-[12.5px] text-muted leading-relaxed mt-1">{task.description}</p>}

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
              {ctx && depth < MAX_TREE_DEPTH - 1 && task.status !== "irrelevant" && (
                <DecomposeChildButton task={task} tree={tree} ctx={ctx} onTreeChange={onTreeChange} />
              )}
            </div>
          )}

          {/* Children (recursive) */}
          {children.length > 0 && (
            <ul className="mt-3 border-t border-border divide-y divide-border">
              {children.map((c, ci) => (
                <TaskRow
                  key={c.id}
                  task={c}
                  index={ci + 1}
                  depth={depth + 1}
                  tree={tree}
                  ctx={ctx}
                  onSelect={onSelect}
                  onToggleLock={onToggleLock}
                  onCommit={onCommit}
                  onTreeChange={onTreeChange}
                />
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onCommit(task.id)}
            title="Verify & Commit"
            className="border border-border w-7 h-7 flex items-center justify-center text-muted hover:text-green hover:border-green transition-colors"
          >
            <CheckCircle2 size={12} />
          </button>
          <button
            onClick={() => onToggleLock(task.id)}
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

function DecomposeChildButton({
  task, tree, ctx, onTreeChange,
}: {
  task: AtomicSubtask;
  tree: TaskTree;
  ctx: ProjectContext;
  onTreeChange: (t: TaskTree) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const next = decomposeSubtask(task.id, ctx, tree);
      onTreeChange(next);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={handleClick}
        disabled={busy}
        className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] font-semibold border border-border text-muted hover:border-violet hover:text-violet disabled:opacity-60 px-3 py-1.5 transition-colors duration-150"
      >
        {busy ? <Loader2 size={10} className="animate-spin" /> : <GitBranch size={10} />}
        Decompose this subtask
      </button>
      {err && <span className="text-[10px] text-rose">⚠ {err}</span>}
    </div>
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
      return <p style={indent} className="text-foreground"><span className="text-cyan">section</span> <code className="text-[11px]">{condition.documentId}</code> contains heading &quot;{condition.headingMatches}&quot;</p>;
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

function formatValue(v: DraftAssertionWrite["value"]): string {
  switch (v.type) {
    case "number": return `${v.value.toLocaleString()}${v.unit ? " " + v.unit : ""}`;
    case "string": return `"${v.value}"`;
    case "boolean": return v.value ? "true" : "false";
    case "date": return v.value;
  }
}

void resolveTree;
