/**
 * Echo — context gatherer.
 *
 * One server-side admin-SDK pass that snapshots every signal the
 * tension detector needs:
 *
 *   • Documents      — latest N per project (title, plain text, age)
 *   • Calendar       — next + previous 7 days of events
 *   • Tasks          — open + recently completed
 *   • Goals          — active goals
 *
 * Caps on every dimension so a busy account stays under the
 * Groq context budget (~40k chars of corpus).
 *
 * Returns a tight, model-readable "Corpus" object. The scan route
 * stringifies it into the user-prompt.
 */

import "server-only";
import { getAdminFirestore } from "@/lib/firebase/admin";

const MAX_DOCS_PER_PROJECT = 8;
const MAX_PROJECTS = 6;
const PER_DOC_CHARS = 1_800;
const CALENDAR_WINDOW_DAYS = 7;
const MAX_TASKS = 60;
const MAX_GOALS = 30;
const MAX_EVENTS = 80;

export interface CorpusDoc {
  id: string;
  projectId: string;
  title: string;
  text: string;
  ageDays: number;
}

export interface CorpusEvent {
  id: string;
  projectId: string | null;
  title: string;
  start: string;
  end: string;
  source?: string;
  durationMin: number;
}

export interface CorpusTask {
  id: string;
  projectId: string;
  title: string;
  status: string;
  due?: string;
  ageDays: number;
}

export interface CorpusGoal {
  id: string;
  projectId: string;
  title: string;
  status: string;
  deadline?: string;
  ageDays: number;
  lastTouchedDays: number;
}

export interface CorpusProject {
  id: string;
  name: string;
}

export interface EchoCorpus {
  uid: string;
  capturedAt: number;
  windowStartIso: string;
  windowEndIso: string;
  projects: CorpusProject[];
  docs: CorpusDoc[];
  events: CorpusEvent[];
  tasks: CorpusTask[];
  goals: CorpusGoal[];
  /** Total prose chars across all collected text — surfaced for logging. */
  totalChars: number;
}

/* ─────────────────────────── helpers ─────────────────────────── */

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/(p|div|li|h1|h2|h3|h4|h5|h6|blockquote|pre|br)>/gi, ". ")
    .replace(/<br\s*\/?\s*>/gi, ". ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function millisOf(v: unknown): number {
  if (!v) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof (v as { toMillis?: () => number })?.toMillis === "function") {
    return (v as { toMillis: () => number }).toMillis();
  }
  return 0;
}

function ageDays(ts: number): number {
  if (!ts) return 9999;
  return Math.max(0, Math.floor((Date.now() - ts) / 86_400_000));
}

/* ─────────────────────────── main ─────────────────────────── */

export async function gatherEchoCorpus(uid: string): Promise<EchoCorpus> {
  const fs = getAdminFirestore();
  const now = Date.now();
  const windowStart = new Date(now - CALENDAR_WINDOW_DAYS * 86_400_000).toISOString();
  const windowEnd = new Date(now + CALENDAR_WINDOW_DAYS * 86_400_000).toISOString();

  // 1. Projects — sorted by updatedAt, cap to MAX_PROJECTS.
  const projectsSnap = await fs
    .collection("projects")
    .where("userId", "==", uid)
    .orderBy("updatedAt", "desc")
    .limit(MAX_PROJECTS)
    .get();
  const projects: CorpusProject[] = projectsSnap.docs.map((d) => {
    const data = d.data() as { name?: string };
    return { id: d.id, name: data.name ?? "Untitled project" };
  });

  // 2. Docs — top N per project. Stripped + truncated.
  const docs: CorpusDoc[] = [];
  let totalChars = 0;
  for (const p of projects) {
    const dSnap = await fs
      .collection("documents")
      .where("userId", "==", uid)
      .where("projectId", "==", p.id)
      .orderBy("updatedAt", "desc")
      .limit(MAX_DOCS_PER_PROJECT)
      .get();
    for (const d of dSnap.docs) {
      const data = d.data() as { title?: string; content?: string; updatedAt?: unknown };
      const text = htmlToText(typeof data.content === "string" ? data.content : "").slice(
        0,
        PER_DOC_CHARS,
      );
      if (!text) continue;
      docs.push({
        id: d.id,
        projectId: p.id,
        title: (data.title ?? "Untitled").slice(0, 120),
        text,
        ageDays: ageDays(millisOf(data.updatedAt)),
      });
      totalChars += text.length;
    }
  }

  // 3. Events — calendar window across all projects, plus the mirror.
  const events: CorpusEvent[] = [];
  // Per-project events live at `users/{uid}/projects/{pid}/events`.
  for (const p of projects) {
    const eSnap = await fs
      .collection(`users/${uid}/projects/${p.id}/events`)
      .where("start", ">=", windowStart)
      .where("start", "<=", windowEnd)
      .limit(MAX_EVENTS)
      .get()
      .catch(() => null);
    if (!eSnap) continue;
    for (const e of eSnap.docs) {
      const data = e.data() as { title?: string; start?: string; end?: string };
      const start = data.start ?? "";
      const end = data.end ?? data.start ?? "";
      if (!start) continue;
      events.push({
        id: e.id,
        projectId: p.id,
        title: (data.title ?? "Untitled").slice(0, 120),
        start,
        end,
        durationMin: Math.max(
          0,
          Math.round((Date.parse(end) - Date.parse(start)) / 60_000),
        ),
      });
      if (events.length >= MAX_EVENTS) break;
    }
    if (events.length >= MAX_EVENTS) break;
  }
  // Mirror events (Google + Notion) live at the top of the user subtree.
  if (events.length < MAX_EVENTS) {
    const mSnap = await fs
      .collection(`users/${uid}/google_events`)
      .where("start", ">=", windowStart)
      .where("start", "<=", windowEnd)
      .limit(MAX_EVENTS - events.length)
      .get()
      .catch(() => null);
    if (mSnap) {
      for (const e of mSnap.docs) {
        const data = e.data() as {
          title?: string;
          start?: string;
          end?: string;
          projectId?: string | null;
          externalSource?: string;
        };
        const start = data.start ?? "";
        const end = data.end ?? data.start ?? "";
        if (!start) continue;
        events.push({
          id: e.id,
          projectId: data.projectId ?? null,
          title: (data.title ?? "Untitled").slice(0, 120),
          start,
          end,
          source: data.externalSource,
          durationMin: Math.max(
            0,
            Math.round((Date.parse(end) - Date.parse(start)) / 60_000),
          ),
        });
      }
    }
  }

  // 4. Tasks — open + recently-touched, across all projects.
  const tasks: CorpusTask[] = [];
  for (const p of projects) {
    const tSnap = await fs
      .collection(`users/${uid}/projects/${p.id}/tasks`)
      .where("userId", "==", uid)
      .orderBy("updatedAt", "desc")
      .limit(20)
      .get()
      .catch(() => null);
    if (!tSnap) continue;
    for (const t of tSnap.docs) {
      const data = t.data() as {
        title?: string;
        status?: string;
        due?: string;
        updatedAt?: unknown;
      };
      tasks.push({
        id: t.id,
        projectId: p.id,
        title: (data.title ?? "Untitled task").slice(0, 120),
        status: data.status ?? "pending",
        due: data.due,
        ageDays: ageDays(millisOf(data.updatedAt)),
      });
      if (tasks.length >= MAX_TASKS) break;
    }
    if (tasks.length >= MAX_TASKS) break;
  }

  // 5. Goals — every active goal across all projects.
  const goals: CorpusGoal[] = [];
  for (const p of projects) {
    const gSnap = await fs
      .collection(`users/${uid}/projects/${p.id}/goals`)
      .where("userId", "==", uid)
      .limit(MAX_GOALS)
      .get()
      .catch(() => null);
    if (!gSnap) continue;
    for (const g of gSnap.docs) {
      const data = g.data() as {
        title?: string;
        status?: string;
        deadline?: string;
        createdAt?: unknown;
        updatedAt?: unknown;
      };
      goals.push({
        id: g.id,
        projectId: p.id,
        title: (data.title ?? "Untitled goal").slice(0, 120),
        status: data.status ?? "active",
        deadline: data.deadline,
        ageDays: ageDays(millisOf(data.createdAt)),
        lastTouchedDays: ageDays(millisOf(data.updatedAt)),
      });
      if (goals.length >= MAX_GOALS) break;
    }
    if (goals.length >= MAX_GOALS) break;
  }

  return {
    uid,
    capturedAt: now,
    windowStartIso: windowStart,
    windowEndIso: windowEnd,
    projects,
    docs,
    events,
    tasks,
    goals,
    totalChars,
  };
}

/**
 * Stringify the corpus into a single user-prompt block. Compact —
 * the model doesn't need flowing prose, it needs structured signal.
 */
export function formatCorpus(c: EchoCorpus): string {
  const parts: string[] = [];

  parts.push(`# Workspace snapshot for uid=${c.uid}`);
  parts.push(`Captured: ${new Date(c.capturedAt).toISOString()}`);
  parts.push(`Calendar window: ${c.windowStartIso} → ${c.windowEndIso}`);
  parts.push("");

  parts.push(`## Projects (${c.projects.length})`);
  for (const p of c.projects) {
    parts.push(`- [${p.id}] ${p.name}`);
  }
  parts.push("");

  parts.push(`## Active goals (${c.goals.length})`);
  if (c.goals.length === 0) parts.push("- none");
  for (const g of c.goals) {
    const deadline = g.deadline ? ` · due ${g.deadline}` : "";
    parts.push(
      `- [${g.id}] (project=${g.projectId}) status=${g.status}${deadline} · last touched ${g.lastTouchedDays}d ago — "${g.title}"`,
    );
  }
  parts.push("");

  parts.push(`## Open tasks (${c.tasks.length})`);
  if (c.tasks.length === 0) parts.push("- none");
  for (const t of c.tasks) {
    const due = t.due ? ` · due ${t.due}` : "";
    parts.push(
      `- [${t.id}] (project=${t.projectId}) ${t.status}${due} · ${t.ageDays}d old — "${t.title}"`,
    );
  }
  parts.push("");

  parts.push(`## Calendar — ${c.events.length} events`);
  if (c.events.length === 0) parts.push("- none");
  for (const e of c.events) {
    parts.push(
      `- [${e.id}] (project=${e.projectId ?? "—"}) ${e.start} → ${e.end} · ${e.durationMin}m${e.source ? ` · source=${e.source}` : ""} — "${e.title}"`,
    );
  }
  parts.push("");

  parts.push(`## Documents (${c.docs.length})`);
  for (const d of c.docs) {
    parts.push(
      `### [${d.id}] "${d.title}" (project=${d.projectId}, ${d.ageDays}d old)`,
    );
    parts.push(`"""${d.text}"""`);
    parts.push("");
  }

  return parts.join("\n");
}
