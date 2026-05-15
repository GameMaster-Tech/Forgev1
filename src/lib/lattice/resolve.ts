/**
 * Resolver — evaluates a `ResolutionCondition` against the current
 * `ProjectContext` and decides each subtask's `TaskStatus`.
 *
 * Pure. Auto-reverts complete → pending if the underlying data is
 * deleted or becomes stale. User-locked tasks bypass the resolver.
 *
 * Cycle safety: `task-complete` conditions are followed in a single
 * topological walk; cycles are pre-rejected at decomposition time, but
 * the resolver also tracks a visited-set as a belt-and-braces guard.
 */

import { trustAt } from "../pulse/decay";
import type { Assertion } from "../sync/types";
import type {
  AssertionExistsCondition,
  AssertionFreshCondition,
  AssertionValueCondition,
  AtomicSubtask,
  CompositeAndCondition,
  CompositeOrCondition,
  DocumentMentionsCondition,
  DocumentSectionCondition,
  ManualCondition,
  ProjectContext,
  ProjectDocument,
  ResolutionCondition,
  StatusHistoryEntry,
  TaskCompleteCondition,
  TaskId,
  TaskStatus,
  TaskTree,
} from "./types";

/* ───────────── result types ───────────── */

export type ConditionVerdict =
  | { ok: true; reason: string }
  | { ok: false; reason: string; blocked?: boolean };

export interface ResolverOptions {
  /** Override "now" for deterministic tests. */
  now?: number;
}

/* ───────────── condition evaluation ───────────── */

export function evaluateCondition(
  condition: ResolutionCondition,
  ctx: ProjectContext,
  tree: TaskTree,
  options: ResolverOptions = {},
  visited: Set<string> = new Set(),
): ConditionVerdict {
  // Cycle guard for nested task-complete conditions.
  if (visited.has(condition.id)) {
    return { ok: false, reason: "cycle in resolution conditions", blocked: true };
  }
  visited.add(condition.id);

  switch (condition.kind) {
    case "assertion-exists":
      return checkAssertionExists(condition, ctx);
    case "assertion-fresh":
      return checkAssertionFresh(condition, ctx, options.now ?? Date.now());
    case "assertion-value":
      return checkAssertionValue(condition, ctx);
    case "document-section":
      return checkDocumentSection(condition, ctx);
    case "document-mentions":
      return checkDocumentMentions(condition, ctx);
    case "task-complete":
      return checkTaskComplete(condition, ctx, tree, options, visited);
    case "and":
      return checkAnd(condition, ctx, tree, options, visited);
    case "or":
      return checkOr(condition, ctx, tree, options, visited);
    case "manual":
      return checkManual(condition);
  }
}

/* ───────────── leaf checks ───────────── */

function findAssertion(ctx: ProjectContext, key: string): Assertion | undefined {
  // Project context can contain multiple assertions with the same key
  // when the user edits without dedup. Pick the most recently sourced.
  let best: Assertion | undefined;
  for (const a of ctx.assertions) {
    if (a.key !== key) continue;
    if (!best || a.sourcedAt > best.sourcedAt) best = a;
  }
  return best;
}

function checkAssertionExists(c: AssertionExistsCondition, ctx: ProjectContext): ConditionVerdict {
  const a = findAssertion(ctx, c.assertionKey);
  if (!a) {
    return { ok: false, reason: `assertion \`${c.assertionKey}\` not found in project` };
  }
  return { ok: true, reason: `\`${c.assertionKey}\` exists` };
}

function checkAssertionFresh(
  c: AssertionFreshCondition,
  ctx: ProjectContext,
  now: number,
): ConditionVerdict {
  const a = findAssertion(ctx, c.assertionKey);
  if (!a) return { ok: false, reason: `assertion \`${c.assertionKey}\` missing — task reset to pending` };
  const minTrust = c.minTrust ?? 0.5;
  const trust = trustAt(a, now);
  if (trust < minTrust) {
    return {
      ok: false,
      reason: `\`${c.assertionKey}\` trust ${(trust * 100).toFixed(0)}% < ${(minTrust * 100).toFixed(0)}%`,
    };
  }
  if (c.maxAgeDays != null) {
    const ageDays = Math.max(0, (now - a.sourcedAt) / 86_400_000);
    if (ageDays > c.maxAgeDays) {
      return {
        ok: false,
        reason: `\`${c.assertionKey}\` is ${Math.round(ageDays)}d old — older than the ${c.maxAgeDays}d ceiling`,
      };
    }
  }
  return { ok: true, reason: `\`${c.assertionKey}\` is fresh (trust ${(trust * 100).toFixed(0)}%)` };
}

function checkAssertionValue(c: AssertionValueCondition, ctx: ProjectContext): ConditionVerdict {
  const a = findAssertion(ctx, c.assertionKey);
  if (!a) return { ok: false, reason: `assertion \`${c.assertionKey}\` missing` };
  if (c.range && a.value.type === "number") {
    const v = a.value.value;
    if (c.range.min != null && v < c.range.min) {
      return { ok: false, reason: `${c.assertionKey}=${v} < ${c.range.min}` };
    }
    if (c.range.max != null && v > c.range.max) {
      return { ok: false, reason: `${c.assertionKey}=${v} > ${c.range.max}` };
    }
  }
  if (c.oneOf && c.oneOf.length > 0) {
    const hit = c.oneOf.some((candidate) => {
      // Strict equality for primitives; deep equality for dates/strings.
      if (typeof candidate === typeof a.value.value) return candidate === a.value.value;
      return false;
    });
    if (!hit) return { ok: false, reason: `${c.assertionKey}=${stringifyValue(a)} not in allowed set` };
  }
  if (c.predicate) {
    let pass = false;
    try {
      pass = c.predicate(a);
    } catch (err) {
      return { ok: false, reason: `predicate threw: ${(err as Error).message}`, blocked: true };
    }
    if (!pass) return { ok: false, reason: `predicate rejected ${c.assertionKey}` };
  }
  return { ok: true, reason: `\`${c.assertionKey}\` satisfies the value rule` };
}

function checkDocumentSection(c: DocumentSectionCondition, ctx: ProjectContext): ConditionVerdict {
  const doc = ctx.documents.find((d) => d.id === c.documentId);
  if (!doc) return { ok: false, reason: `document \`${c.documentId}\` missing`, blocked: true };
  const re = new RegExp(`^#+\\s+.*${escapeRegex(c.headingMatches)}.*$`, "im");
  return re.test(doc.body)
    ? { ok: true, reason: `${doc.title}: "${c.headingMatches}" present` }
    : { ok: false, reason: `${doc.title}: heading "${c.headingMatches}" not yet written` };
}

function checkDocumentMentions(c: DocumentMentionsCondition, ctx: ProjectContext): ConditionVerdict {
  const doc = ctx.documents.find((d) => d.id === c.documentId);
  if (!doc) return { ok: false, reason: `document \`${c.documentId}\` missing`, blocked: true };
  let re: RegExp;
  try {
    re = new RegExp(c.pattern, c.caseInsensitive === false ? "" : "i");
  } catch (err) {
    return { ok: false, reason: `invalid regex: ${(err as Error).message}`, blocked: true };
  }
  return re.test(doc.body)
    ? { ok: true, reason: `${doc.title}: contains "${c.pattern}"` }
    : { ok: false, reason: `${doc.title}: missing mention of "${c.pattern}"` };
}

function checkTaskComplete(
  c: TaskCompleteCondition,
  ctx: ProjectContext,
  tree: TaskTree,
  opts: ResolverOptions,
  visited: Set<string>,
): ConditionVerdict {
  const task = tree.tasks.get(c.taskId);
  if (!task) return { ok: false, reason: `prerequisite task ${c.taskId} not found`, blocked: true };
  // Recursively evaluate the prerequisite's own condition.
  const verdict = evaluateCondition(task.resolutionCondition, ctx, tree, opts, visited);
  if (verdict.ok) return { ok: true, reason: `prereq "${task.title}" complete` };
  return { ok: false, reason: `prereq "${task.title}" not yet complete` };
}

function checkAnd(
  c: CompositeAndCondition,
  ctx: ProjectContext,
  tree: TaskTree,
  opts: ResolverOptions,
  visited: Set<string>,
): ConditionVerdict {
  if (c.conditions.length === 0) return { ok: true, reason: "empty AND ⇒ vacuously true" };
  const failures: string[] = [];
  let anyBlocked = false;
  for (const sub of c.conditions) {
    const v = evaluateCondition(sub, ctx, tree, opts, new Set(visited));
    if (!v.ok) {
      failures.push(v.reason);
      if (v.blocked) anyBlocked = true;
    }
  }
  if (failures.length === 0) return { ok: true, reason: `all ${c.conditions.length} requirements met` };
  return { ok: false, reason: failures.join(" · "), blocked: anyBlocked };
}

function checkOr(
  c: CompositeOrCondition,
  ctx: ProjectContext,
  tree: TaskTree,
  opts: ResolverOptions,
  visited: Set<string>,
): ConditionVerdict {
  if (c.conditions.length === 0) return { ok: false, reason: "empty OR ⇒ no condition can be met", blocked: true };
  const failures: string[] = [];
  for (const sub of c.conditions) {
    const v = evaluateCondition(sub, ctx, tree, opts, new Set(visited));
    if (v.ok) return { ok: true, reason: `${v.reason} (1 of ${c.conditions.length})` };
    failures.push(v.reason);
  }
  return { ok: false, reason: failures.join(" · ") };
}

function checkManual(c: ManualCondition): ConditionVerdict {
  // Manual conditions never auto-complete. The resolver leaves the
  // existing status untouched (the apply-status function below).
  return { ok: false, reason: c.hint ?? "manual check — mark when done" };
}

/* ───────────── status decision ───────────── */

export interface StatusDecision {
  next: TaskStatus;
  reason: string;
  /** Whether the verdict actually changed something. */
  changed: boolean;
}

/**
 * Compute the next status for a single task. Respects user-lock and
 * leaves manual-condition tasks alone.
 */
export function decideStatus(
  task: AtomicSubtask,
  ctx: ProjectContext,
  tree: TaskTree,
  opts: ResolverOptions = {},
): StatusDecision {
  if (task.userLocked || task.status === "user-locked") {
    return { next: task.status, reason: "user-locked", changed: false };
  }
  if (task.status === "irrelevant") {
    return { next: "irrelevant", reason: "removed by rebranch", changed: false };
  }
  if (task.resolutionCondition.kind === "manual") {
    return { next: task.status, reason: "manual condition — no auto-resolve", changed: false };
  }
  const verdict = evaluateCondition(task.resolutionCondition, ctx, tree, opts);
  let next: TaskStatus;
  if (verdict.ok) {
    next = "complete";
  } else if (verdict.blocked) {
    next = "blocked";
  } else if (task.status === "in_progress") {
    // The user has explicitly started working — don't yank them back to
    // pending. Stays "in_progress" until they either complete the
    // resolution data or hand off to the resolver.
    next = "in_progress";
  } else {
    next = "pending";
  }
  return { next, reason: verdict.reason, changed: next !== task.status };
}

/**
 * Walk the tree once and update statuses. Returns the modified tree
 * plus a list of changed task ids. Pure — never mutates the input
 * tree; returns a new one.
 */
export function resolveTree(
  tree: TaskTree,
  ctx: ProjectContext,
  opts: ResolverOptions = {},
): { tree: TaskTree; changed: { id: TaskId; from: TaskStatus; to: TaskStatus }[] } {
  const next = cloneTree(tree);
  const changed: { id: TaskId; from: TaskStatus; to: TaskStatus }[] = [];
  // Bottom-up: evaluate leaves first so task-complete conditions
  // referencing children see fresh statuses.
  const order = topoOrderBottomUp(tree);
  for (const id of order) {
    const cur = next.tasks.get(id);
    if (!cur) continue;
    const decision = decideStatus(cur, ctx, next, opts);
    if (!decision.changed) continue;
    const history: StatusHistoryEntry = {
      status: decision.next,
      at: opts.now ?? Date.now(),
      by: "resolver",
      reason: decision.reason,
    };
    next.tasks.set(id, {
      ...cur,
      status: decision.next,
      updatedAt: opts.now ?? Date.now(),
      history: [...cur.history, history].slice(-20), // bounded history
    });
    changed.push({ id, from: cur.status, to: decision.next });
  }
  return { tree: next, changed };
}

/* ───────────── helpers ───────────── */

function topoOrderBottomUp(tree: TaskTree): TaskId[] {
  // DFS post-order from the root. Defensive against cycles via a
  // visited-set; cycles shouldn't exist but the cost is trivial.
  const out: TaskId[] = [];
  const seen = new Set<TaskId>();
  const visit = (id: TaskId) => {
    if (seen.has(id)) return;
    seen.add(id);
    const children = tree.childrenOf.get(id) ?? [];
    for (const c of children) visit(c);
    out.push(id);
  };
  visit(tree.rootId);
  return out;
}

export function cloneTree(t: TaskTree): TaskTree {
  return {
    projectId: t.projectId,
    rootId: t.rootId,
    tasks: new Map(t.tasks),
    childrenOf: new Map(Array.from(t.childrenOf.entries()).map(([k, v]) => [k, [...v]])),
    updatedAt: t.updatedAt,
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stringifyValue(a: Assertion): string {
  switch (a.value.type) {
    case "number": return `${a.value.value}`;
    case "string": return `"${a.value.value}"`;
    case "boolean": return a.value.value ? "true" : "false";
    case "date": return a.value.value;
  }
}
