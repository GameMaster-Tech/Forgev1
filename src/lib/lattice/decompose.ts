/**
 * Decomposer — the public `decomposeTask()`.
 *
 * Takes a parent string and a project context, returns either a brand-
 * new TaskTree or a merged update of an existing one. Drives every
 * other module (parser, resolver, draft, watcher).
 *
 * The decomposer is the *single source of truth* for which subtasks
 * should exist given the current project state. The watcher consumes
 * the result and surfaces add/remove/mutate diffs to the UI.
 *
 * Strategy
 * ─────────
 *   1. Parse the parent string → `ParsedIntent`.
 *   2. Choose a template from `INTENT_TEMPLATES`. Templates are pure
 *      functions that, given (intent, ctx), return `ProposedSubtask[]`.
 *   3. Build resolution conditions and bound keys per proposed subtask.
 *   4. Synthesise drafts.
 *   5. If `existingTree` is passed, merge — preserve user edits,
 *      retire signatures no longer in the proposal, inject new ones.
 *
 * Cycle prevention: child subtasks may reference each other as
 * prerequisites (via array index), but the merger never produces an
 * edge that closes a cycle. Detected via a DFS check before commit.
 */

import { intentSignature, parseIntent } from "./parser";
import { synthesizeDraft } from "./draft";
import { cloneTree } from "./resolve";
import type {
  AtomicSubtask,
  DecomposeOptions,
  DecompositionPlan,
  DocumentMentionsCondition,
  DraftOutcome,
  ParsedIntent,
  ProjectContext,
  ProposedSubtask,
  ResolutionCondition,
  StatusHistoryEntry,
  TaskId,
  TaskTree,
} from "./types";

const DEFAULT_MAX_DEPTH = 5;
const DEFAULT_MAX_FANOUT = 12;

/* ───────────── public entry ───────────── */

export interface DecomposeResult {
  tree: TaskTree;
  plan: DecompositionPlan;
  added: TaskId[];
  removed: TaskId[];
  draftsRefreshed: TaskId[];
}

/**
 * Decompose a high-level task into atomic subtasks.
 *
 *   @param parentTask    Free-form task string.
 *   @param projectContext  Snapshot of project assertions, docs, blocks.
 *   @param existingTree  When present, merge into this tree.
 *   @param options       Caps, "now", etc.
 */
export function decomposeTask(
  parentTask: string,
  projectContext: ProjectContext,
  existingTree?: TaskTree,
  options: DecomposeOptions = {},
): DecomposeResult {
  if (!parentTask || !parentTask.trim()) {
    throw new Error("Lattice.decomposeTask: parentTask is empty");
  }
  if (!projectContext || !projectContext.projectId) {
    throw new Error("Lattice.decomposeTask: projectContext is missing or malformed");
  }
  const now = options.now ?? Date.now();
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxFanout = options.maxFanout ?? DEFAULT_MAX_FANOUT;
  const preserveExisting = options.preserveExisting ?? true;

  const intent = parseIntent(parentTask);
  const template = INTENT_TEMPLATES[intent.kind] ?? INTENT_TEMPLATES.generic;
  const raw = template(intent, projectContext);
  const proposed = raw.slice(0, maxFanout); // enforce fanout cap

  // Synthesise drafts for every proposal.
  for (const p of proposed) {
    if (p.draftOutcome) continue;
    p.draftOutcome = synthesizeDraft({
      parentIntent: intent,
      title: p.title,
      intentTag: p.intentTag,
      boundAssertionKeys: p.boundAssertionKeys,
      boundDocumentIds: p.boundDocumentIds,
      ctx: projectContext,
      now,
    });
  }

  const plan: DecompositionPlan = { rootIntent: intent, proposed };
  const result = mergePlanIntoTree({
    projectId: projectContext.projectId,
    plan,
    parentTask,
    existingTree,
    preserveExisting,
    maxDepth,
    now,
  });

  return result;
}

/* ───────────── merge ───────────── */

interface MergeArgs {
  projectId: string;
  plan: DecompositionPlan;
  parentTask: string;
  existingTree?: TaskTree;
  preserveExisting: boolean;
  maxDepth: number;
  now: number;
}

function mergePlanIntoTree(args: MergeArgs): DecomposeResult {
  const { projectId, plan, parentTask, existingTree, preserveExisting, maxDepth, now } = args;

  // Build (or reuse) the root.
  let tree: TaskTree;
  let rootId: TaskId;
  if (existingTree && existingTree.projectId === projectId) {
    tree = cloneTree(existingTree);
    rootId = tree.rootId;
    const existingRoot = tree.tasks.get(rootId);
    if (existingRoot) {
      // Update the root title if the user changed the parent prompt.
      if (existingRoot.title !== parentTask) {
        tree.tasks.set(rootId, {
          ...existingRoot,
          title: parentTask,
          updatedAt: now,
        });
      }
    }
  } else {
    rootId = newId(now, 0);
    const root: AtomicSubtask = {
      id: rootId,
      parentId: null,
      title: parentTask,
      status: "in_progress",
      userLocked: false,
      resolutionCondition: { id: condId("root", 0), kind: "and", conditions: [] },
      depth: 0,
      signature: `root:${intentSignature(plan.rootIntent)}`,
      createdAt: now,
      updatedAt: now,
      boundAssertionKeys: [],
      boundDocumentIds: [],
      history: [
        { status: "in_progress", at: now, by: "decompose", reason: "root created" },
      ],
      prerequisites: [],
      intentTag: "root",
    };
    tree = {
      projectId,
      rootId,
      tasks: new Map([[rootId, root]]),
      childrenOf: new Map([[rootId, []]]),
      updatedAt: now,
    };
  }

  // Index existing children by signature.
  const existingChildren = tree.childrenOf.get(rootId) ?? [];
  const existingBySig = new Map<string, AtomicSubtask>();
  for (const cid of existingChildren) {
    const c = tree.tasks.get(cid);
    if (c) existingBySig.set(c.signature, c);
  }

  // Build the new children list in proposal order, merging where
  // signatures match.
  const newChildren: TaskId[] = [];
  const added: TaskId[] = [];
  const draftsRefreshed: TaskId[] = [];

  // First pass: instantiate / merge subtasks (without prerequisites).
  const proposalIndexToId = new Map<number, TaskId>();
  plan.proposed.forEach((p, idx) => {
    const prior = existingBySig.get(p.signature);
    if (prior && preserveExisting) {
      // Preserve user fields (status, history) but refresh
      // condition + draft + bindings since the project changed.
      const reentry: StatusHistoryEntry = {
        status: prior.status, at: now, by: "decompose", reason: "re-decomposed",
      };
      const refreshed: AtomicSubtask = {
        ...prior,
        title: p.title,
        description: p.description ?? prior.description,
        resolutionCondition: p.resolutionCondition,
        draftOutcome: p.draftOutcome,
        boundAssertionKeys: p.boundAssertionKeys,
        boundDocumentIds: p.boundDocumentIds,
        intentTag: p.intentTag,
        updatedAt: now,
        history: [...prior.history, reentry].slice(-20),
      };
      tree.tasks.set(prior.id, refreshed);
      newChildren.push(prior.id);
      proposalIndexToId.set(idx, prior.id);
      draftsRefreshed.push(prior.id);
    } else {
      const id = newId(now, idx + 1);
      const subtask: AtomicSubtask = {
        id,
        parentId: rootId,
        title: p.title,
        description: p.description,
        status: "pending",
        userLocked: false,
        resolutionCondition: p.resolutionCondition,
        draftOutcome: p.draftOutcome,
        depth: 1,
        signature: p.signature,
        createdAt: now,
        updatedAt: now,
        boundAssertionKeys: p.boundAssertionKeys,
        boundDocumentIds: p.boundDocumentIds,
        history: [
          { status: "pending", at: now, by: "decompose", reason: "added by decomposer" },
        ],
        prerequisites: [], // wired in pass 2
        intentTag: p.intentTag,
      };
      if (subtask.depth > maxDepth) {
        // Decomposer-internal safeguard; the template should never
        // propose anything deeper but we keep the guard for future
        // recursive expansions.
        return;
      }
      tree.tasks.set(id, subtask);
      newChildren.push(id);
      added.push(id);
      proposalIndexToId.set(idx, id);
    }
  });

  // Second pass: wire prerequisites by index.
  plan.proposed.forEach((p, idx) => {
    const id = proposalIndexToId.get(idx);
    if (!id) return;
    const task = tree.tasks.get(id);
    if (!task) return;
    const prereqIds = p.prerequisites
      .map((j) => proposalIndexToId.get(j))
      .filter((x): x is TaskId => !!x && x !== id);
    if (prereqIds.length === task.prerequisites.length &&
        prereqIds.every((x, i) => x === task.prerequisites[i])) return;
    tree.tasks.set(id, { ...task, prerequisites: prereqIds });
  });

  // Cycle safety on the prerequisite graph.
  const cycleNode = findPrerequisiteCycle(tree, newChildren);
  if (cycleNode) {
    // Should never happen; templates only reference earlier-indexed
    // proposals. Strip prerequisites on the offending node so the tree
    // remains usable.
    const t = tree.tasks.get(cycleNode);
    if (t) tree.tasks.set(cycleNode, { ...t, prerequisites: [] });
  }

  // Determine which previous children are no longer in the new plan.
  const newSignatures = new Set(plan.proposed.map((p) => p.signature));
  const removed: TaskId[] = [];
  for (const cid of existingChildren) {
    const c = tree.tasks.get(cid);
    if (!c) continue;
    if (!newSignatures.has(c.signature) && !c.userLocked) {
      // Mark irrelevant rather than delete; the UI surfaces it for one
      // cycle then the next rebranch sweeps it out (see `pruneTree`).
      const tombstone: StatusHistoryEntry = {
        status: "irrelevant",
        at: now,
        by: "decompose",
        reason: "no longer required by decomposition",
      };
      tree.tasks.set(cid, {
        ...c,
        status: "irrelevant",
        removedAt: now,
        updatedAt: now,
        history: [...c.history, tombstone].slice(-20),
      });
      removed.push(cid);
      // User-locked tasks survive even if no longer in the plan; they're
      // kept under the same parent.
    }
  }

  // Children list = new children + any user-locked previous children that
  // were not in the new plan.
  const userLockedSurvivors = existingChildren.filter((cid) => {
    if (newChildren.includes(cid)) return false;
    const c = tree.tasks.get(cid);
    return !!c && c.userLocked;
  });
  tree.childrenOf.set(rootId, [...newChildren, ...userLockedSurvivors]);
  tree.updatedAt = now;

  return { tree, plan, added, removed, draftsRefreshed };
}

/* ───────────── removal sweep ───────────── */

/**
 * Permanently drop tasks marked `irrelevant` more than `staleMs` ago.
 * Call between rebranches so the tree doesn't accumulate tombstones.
 */
export function pruneTree(tree: TaskTree, staleMs = 7 * 86_400_000, now = Date.now()): TaskTree {
  const next = cloneTree(tree);
  const toDrop: TaskId[] = [];
  for (const [id, task] of next.tasks) {
    if (task.status !== "irrelevant" || !task.removedAt) continue;
    if (now - task.removedAt > staleMs) toDrop.push(id);
  }
  for (const id of toDrop) {
    next.tasks.delete(id);
    // Scrub from any childrenOf list.
    for (const [pid, kids] of next.childrenOf) {
      const i = kids.indexOf(id);
      if (i >= 0) {
        const k = [...kids];
        k.splice(i, 1);
        next.childrenOf.set(pid, k);
      }
    }
    next.childrenOf.delete(id);
  }
  return next;
}

/* ───────────── templates ───────────── */

type Template = (intent: ParsedIntent, ctx: ProjectContext) => ProposedSubtask[];

const INTENT_TEMPLATES: Record<ParsedIntent["kind"], Template> = {
  hire: hireTemplate,
  launch: launchTemplate,
  research: researchTemplate,
  budget: budgetTemplate,
  policy: policyTemplate,
  report: reportTemplate,
  deadline: deadlineTemplate,
  generic: genericTemplate,
};

function roleSlug(role: string): "senior" | "staff" | "junior" {
  const r = role.toLowerCase();
  if (/senior|sr\b/.test(r)) return "senior";
  if (/staff|principal/.test(r)) return "staff";
  if (/junior|jr|new.?grad|entry/.test(r)) return "junior";
  return "senior";
}

function hireTemplate(intent: ParsedIntent, ctx: ProjectContext): ProposedSubtask[] {
  const role = intent.object || "engineer";
  const slug = roleSlug(role);
  const count = intent.quantity ?? 1;
  const hiringDocId = (ctx.documents.find((d) => /hiring|recruit/i.test(d.title)) ?? ctx.documents[0])?.id ?? "doc.hiring";
  const compKey = `engineering.${slug}.salary`;
  const specSection = `${role} job spec`;
  const sigBase = intentSignature(intent);

  const out: ProposedSubtask[] = [
    {
      signature: `${sigBase}::comp`,
      title: `Lock comp band for ${role}`,
      description: `Decide and document the salary band for ${role} hires.`,
      intentTag: "hire.role.comp",
      resolutionCondition: andCond([
        existsCond(compKey),
        freshCond(compKey, 0.55),
      ]),
      boundAssertionKeys: [compKey],
      boundDocumentIds: [hiringDocId],
      prerequisites: [],
    },
    {
      signature: `${sigBase}::spec`,
      title: `Write ${role} job spec`,
      description: `Publish a job spec with mission, must-haves, and interview loop.`,
      intentTag: "hire.role.spec",
      resolutionCondition: documentSectionCond(hiringDocId, specSection),
      boundAssertionKeys: [],
      boundDocumentIds: [hiringDocId],
      prerequisites: [],
    },
    {
      signature: `${sigBase}::pipeline`,
      title: `Build sourcing pipeline (${count * 12} top-of-funnel)`,
      description: `Plan outreach across LinkedIn, referrals, and communities.`,
      intentTag: "hire.role.pipeline",
      resolutionCondition: manualCond("Pipeline target is tracked separately; mark when ready."),
      boundAssertionKeys: [],
      boundDocumentIds: [hiringDocId],
      prerequisites: [0, 1],
    },
  ];

  // Add an offer-budget sub-task if a payroll budget exists; that ties
  // the hire to the Sync constraint graph.
  if (ctx.assertions.some((a) => a.key === "budget.payroll.annual")) {
    out.push({
      signature: `${sigBase}::budget-fit`,
      title: `Verify ${count} ${role} fits payroll budget`,
      description: `Sum proposed comp × count and check against the payroll constraint in Sync.`,
      intentTag: "budget.line",
      resolutionCondition: andCond([
        existsCond(`engineering.${slug}.totalComp`),
        valueRangeCond("budget.payroll.annual", { max: undefined }),
      ]),
      boundAssertionKeys: [`engineering.${slug}.totalComp`, "budget.payroll.annual"],
      boundDocumentIds: [hiringDocId, "doc.budget"],
      prerequisites: [0],
    });
  }

  return out;
}

function launchTemplate(intent: ParsedIntent, ctx: ProjectContext): ProposedSubtask[] {
  const subject = intent.object || "feature";
  const date = intent.byDate;
  const sigBase = intentSignature(intent);
  const roadmapDoc = (ctx.documents.find((d) => /roadmap|launch/i.test(d.title)) ?? ctx.documents[0])?.id ?? "doc.roadmap";

  const dateExistsCond: ResolutionCondition | null = date
    ? valueRangeCond("milestone.beta", {})  // beta should be set
    : null;
  void dateExistsCond;

  const subtasks: ProposedSubtask[] = [
    {
      signature: `${sigBase}::checklist`,
      title: `Build ${subject} launch checklist`,
      description: `Cross-functional checklist: eng, marketing, support, security, legal, comms.`,
      intentTag: "launch.checklist",
      resolutionCondition: documentSectionCond(roadmapDoc, "Launch checklist"),
      boundAssertionKeys: [],
      boundDocumentIds: [roadmapDoc],
      prerequisites: [],
    },
    {
      signature: `${sigBase}::beta-date`,
      title: `Set beta launch date`,
      description: `Commit a beta launch date in the roadmap.`,
      intentTag: "deadline",
      resolutionCondition: existsCond("milestone.beta"),
      boundAssertionKeys: ["milestone.beta"],
      boundDocumentIds: [roadmapDoc],
      prerequisites: [],
    },
    {
      signature: `${sigBase}::ga-date`,
      title: `Set GA date (after beta)`,
      description: `GA must follow beta; Sync enforces this.`,
      intentTag: "deadline",
      resolutionCondition: andCond([existsCond("milestone.beta"), existsCond("milestone.ga")]),
      boundAssertionKeys: ["milestone.beta", "milestone.ga"],
      boundDocumentIds: [roadmapDoc],
      prerequisites: [1],
    },
  ];
  return subtasks;
}

function researchTemplate(intent: ParsedIntent, ctx: ProjectContext): ProposedSubtask[] {
  const sigBase = intentSignature(intent);
  const docId = (ctx.documents.find((d) => /research|note|brief/i.test(d.title)) ?? ctx.documents[0])?.id ?? "doc.research";
  return [
    {
      signature: `${sigBase}::brief`,
      title: `Write research brief`,
      description: "Question, hypothesis, method, success criteria.",
      intentTag: "research.brief",
      resolutionCondition: documentSectionCond(docId, "Research brief"),
      boundAssertionKeys: [],
      boundDocumentIds: [docId],
      prerequisites: [],
    },
    {
      signature: `${sigBase}::sources`,
      title: "Cite at least 5 sources",
      description: "Five distinct citations in the brief.",
      intentTag: "research.brief",
      resolutionCondition: mentionsCond(docId, "http.*", true),
      boundAssertionKeys: [],
      boundDocumentIds: [docId],
      prerequisites: [0],
    },
    {
      signature: `${sigBase}::synthesis`,
      title: "Synthesize findings",
      description: "One-paragraph synthesis with hypothesis confirmed or refuted.",
      intentTag: "report.summary",
      resolutionCondition: documentSectionCond(docId, "Synthesis"),
      boundAssertionKeys: [],
      boundDocumentIds: [docId],
      prerequisites: [1],
    },
  ];
}

function budgetTemplate(intent: ParsedIntent, ctx: ProjectContext): ProposedSubtask[] {
  const sigBase = intentSignature(intent);
  const subject = intent.object || "line";
  const docId = (ctx.documents.find((d) => /budget|finance/i.test(d.title)) ?? ctx.documents[0])?.id ?? "doc.budget";
  const lineKey = `budget.line.${subject.toLowerCase().replace(/\s+/g, "-")}`;
  return [
    {
      signature: `${sigBase}::set-line`,
      title: `Set value for ${subject}`,
      description: "Pick a starting number and document the rationale.",
      intentTag: "budget.line",
      resolutionCondition: existsCond(lineKey),
      boundAssertionKeys: [lineKey],
      boundDocumentIds: [docId],
      prerequisites: [],
    },
    {
      signature: `${sigBase}::runway-check`,
      title: "Re-check runway",
      description: "Sync the new burn against the runway floor (12 months).",
      intentTag: "budget.runway",
      resolutionCondition: andCond([existsCond("runway.months"), valueRangeCond("runway.months", { min: 12 })]),
      boundAssertionKeys: ["runway.months"],
      boundDocumentIds: [docId],
      prerequisites: [0],
    },
  ];
}

function policyTemplate(intent: ParsedIntent, ctx: ProjectContext): ProposedSubtask[] {
  const sigBase = intentSignature(intent);
  const docId = (ctx.documents.find((d) => /policy|playbook|memo/i.test(d.title)) ?? ctx.documents[0])?.id ?? "doc.policy";
  return [
    {
      signature: `${sigBase}::draft`,
      title: "Draft policy",
      intentTag: "policy.draft",
      resolutionCondition: documentSectionCond(docId, intent.object || "policy"),
      boundAssertionKeys: [],
      boundDocumentIds: [docId],
      prerequisites: [],
    },
    {
      signature: `${sigBase}::review`,
      title: "Review with stakeholders",
      intentTag: "policy.draft",
      resolutionCondition: manualCond("Mark when stakeholders sign off."),
      boundAssertionKeys: [],
      boundDocumentIds: [docId],
      prerequisites: [0],
    },
  ];
}

function reportTemplate(intent: ParsedIntent, ctx: ProjectContext): ProposedSubtask[] {
  const sigBase = intentSignature(intent);
  const docId = (ctx.documents.find((d) => /update|report|brief/i.test(d.title)) ?? ctx.documents[0])?.id ?? "doc.report";
  return [
    {
      signature: `${sigBase}::wins`,
      title: "Collect wins",
      intentTag: "report.summary",
      resolutionCondition: documentSectionCond(docId, "Wins"),
      boundAssertionKeys: [],
      boundDocumentIds: [docId],
      prerequisites: [],
    },
    {
      signature: `${sigBase}::risks`,
      title: "Surface risks",
      intentTag: "report.summary",
      resolutionCondition: documentSectionCond(docId, "Risks"),
      boundAssertionKeys: [],
      boundDocumentIds: [docId],
      prerequisites: [],
    },
    {
      signature: `${sigBase}::asks`,
      title: "List asks",
      intentTag: "report.summary",
      resolutionCondition: documentSectionCond(docId, "Asks"),
      boundAssertionKeys: [],
      boundDocumentIds: [docId],
      prerequisites: [0, 1],
    },
  ];
}

function deadlineTemplate(intent: ParsedIntent, _ctx: ProjectContext): ProposedSubtask[] {
  const sigBase = intentSignature(intent);
  const date = intent.byDate;
  return [
    {
      signature: `${sigBase}::commit-date`,
      title: `Commit deadline${date ? ` (${date})` : ""}`,
      intentTag: "deadline",
      resolutionCondition: existsCond("milestone.target"),
      boundAssertionKeys: ["milestone.target"],
      boundDocumentIds: [],
      prerequisites: [],
    },
    {
      signature: `${sigBase}::dependencies`,
      title: "Map dependencies",
      intentTag: "generic",
      resolutionCondition: manualCond("Mark once dependencies are documented."),
      boundAssertionKeys: [],
      boundDocumentIds: [],
      prerequisites: [0],
    },
  ];
}

function genericTemplate(intent: ParsedIntent, _ctx: ProjectContext): ProposedSubtask[] {
  const sigBase = intentSignature(intent);
  return [
    {
      signature: `${sigBase}::scope`,
      title: `Define scope: ${intent.object || intent.verb || "task"}`,
      intentTag: "generic",
      resolutionCondition: manualCond("Mark when scope is locked."),
      boundAssertionKeys: [],
      boundDocumentIds: [],
      prerequisites: [],
    },
    {
      signature: `${sigBase}::work`,
      title: "Do the work",
      intentTag: "generic",
      resolutionCondition: manualCond("Mark when complete."),
      boundAssertionKeys: [],
      boundDocumentIds: [],
      prerequisites: [0],
    },
  ];
}

/* ───────────── condition factories ───────────── */

function condId(prefix: string, idx: number): string {
  return `${prefix}_${idx}_${Math.random().toString(36).slice(2, 8)}`;
}

function existsCond(key: string): ResolutionCondition {
  return { id: condId("ex", 0), kind: "assertion-exists", assertionKey: key };
}
function freshCond(key: string, minTrust?: number): ResolutionCondition {
  return { id: condId("fr", 0), kind: "assertion-fresh", assertionKey: key, minTrust };
}
function valueRangeCond(key: string, range: { min?: number; max?: number }): ResolutionCondition {
  return { id: condId("vr", 0), kind: "assertion-value", assertionKey: key, range };
}
function documentSectionCond(docId: string, heading: string): ResolutionCondition {
  return { id: condId("ds", 0), kind: "document-section", documentId: docId, headingMatches: heading };
}
function mentionsCond(docId: string, pattern: string, caseInsensitive = true): DocumentMentionsCondition {
  return { id: condId("dm", 0), kind: "document-mentions", documentId: docId, pattern, caseInsensitive };
}
function manualCond(hint?: string): ResolutionCondition {
  return { id: condId("mn", 0), kind: "manual", hint };
}
function andCond(conditions: ResolutionCondition[]): ResolutionCondition {
  return { id: condId("and", 0), kind: "and", conditions };
}
/** Reserved for OR-composite use in templates. Currently no template wires this. */
export function orCond(conditions: ResolutionCondition[]): ResolutionCondition {
  return { id: condId("or", 0), kind: "or", conditions };
}

/* ───────────── helpers ───────────── */

function newId(now: number, salt: number): TaskId {
  return `t_${now.toString(36)}_${salt.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * DFS over the prerequisite graph (restricted to the supplied node ids
 * — usually the root's children for a depth-1 decomposition).
 * Returns the id of a node participating in a cycle, or `null`.
 */
function findPrerequisiteCycle(tree: TaskTree, nodes: TaskId[]): TaskId | null {
  const VISITING = 1, DONE = 2;
  const colour = new Map<TaskId, number>();

  function dfs(id: TaskId): TaskId | null {
    const c = colour.get(id);
    if (c === DONE) return null;
    if (c === VISITING) return id;
    colour.set(id, VISITING);
    const task = tree.tasks.get(id);
    if (task) {
      for (const p of task.prerequisites) {
        const hit = dfs(p);
        if (hit) return hit;
      }
    }
    colour.set(id, DONE);
    return null;
  }

  for (const id of nodes) {
    const hit = dfs(id);
    if (hit) return hit;
  }
  return null;
}
