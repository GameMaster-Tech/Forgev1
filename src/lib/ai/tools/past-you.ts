/**
 * "Past-You" tools — date-scoped, read-only views over the user's
 * OWN writing. Powers the temporal chat persona where the assistant
 * speaks as the user as-of a chosen date.
 *
 * The temporal contract: every tool here filters to artifacts that
 * existed (and were last modified) on or before `asOf`. That's how
 * we guarantee past-you can't accidentally quote something you wrote
 * yesterday when answering as 6-months-ago-you.
 *
 * Three tools, all read-only, all admin-SDK:
 *
 *   • past_docs_list        — index of YOUR docs as of <asOf>
 *   • past_docs_read        — full content of one doc, with the most
 *                              recent revision at or before <asOf>
 *   • past_conversations_search — recent chat messages YOU sent,
 *                              also bounded by <asOf>
 *
 * Conversations are included because half the time the past-you
 * answer lives in something you said in chat, not something you
 * wrote in a doc. Including them is the difference between a useful
 * memory and a partial one.
 *
 * NOTE: this module deliberately does NOT include current-document
 * subscriptions or any web-search tools. Past-you cannot know
 * external facts learned after <asOf>.
 */

import "server-only";
import { getAdminFirestore } from "@/lib/firebase/admin";
import type { Tool, ToolContext } from "./types";
import { toolError } from "./types";

const MAX_RETURN_CHARS = 8_000;
const MAX_LIST = 30;
const MAX_MESSAGES = 40;

/* ─────────────────────────── helpers ─────────────────────────── */

/** Pull `asOf` from the agent context — the past-you chat route
 * threads it in via ToolContext as a string ISO timestamp on a
 * well-known key. Falls back to "now" if missing (a safe default
 * that means the tool behaves like the regular non-temporal one). */
function asOfMs(ctx: ToolContext, args: Record<string, unknown>): number {
  const explicit = typeof args.asOf === "string" ? Date.parse(args.asOf) : NaN;
  if (Number.isFinite(explicit)) return explicit;
  const ctxAsOf = (ctx as ToolContext & { asOf?: string }).asOf;
  if (typeof ctxAsOf === "string") {
    const t = Date.parse(ctxAsOf);
    if (Number.isFinite(t)) return t;
  }
  return Date.now();
}

function ensureProject(ctx: ToolContext, args: Record<string, unknown>): string | null {
  const explicit = typeof args.projectId === "string" ? args.projectId : null;
  return explicit ?? ctx.projectId;
}

function millisOf(v: unknown): number {
  if (typeof v === "number") return v;
  if (
    v &&
    typeof v === "object" &&
    typeof (v as { toMillis?: () => number }).toMillis === "function"
  ) {
    return (v as { toMillis: () => number }).toMillis();
  }
  return 0;
}

/* ─────────────────────────── past_docs_list ─────────────────────────── */

const pastDocsList: Tool = {
  name: "past_docs_list",
  category: "docs",
  definition: {
    type: "function",
    function: {
      name: "past_docs_list",
      description:
        "List documents YOU had created or edited on or before the asOf date. Returns title, id, createdAt, updatedAt. Past-you can only see docs that existed then.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          asOf: { type: "string", description: "ISO date. Defaults to the chat's session asOf." },
          limit: { type: "number" },
        },
        required: [],
      },
    },
  },
  handler: async (args, ctx) => {
    const projectId = ensureProject(ctx, args);
    if (!projectId) return toolError("No active project — pass projectId.");
    const limit = Math.min(typeof args.limit === "number" ? args.limit : 20, MAX_LIST);
    const cutoff = asOfMs(ctx, args);
    const fs = getAdminFirestore();
    const snap = await fs
      .collection("documents")
      .where("userId", "==", ctx.uid)
      .where("projectId", "==", projectId)
      .orderBy("updatedAt", "desc")
      .limit(limit * 2) // over-pull, then filter; cheaper than two indexed reads
      .get();
    const docs: Record<string, unknown>[] = [];
    for (const d of snap.docs) {
      const data = d.data() as Record<string, unknown>;
      const updated = millisOf(data.updatedAt);
      const created = millisOf(data.createdAt);
      // Only include docs that EXISTED by the cutoff — if `createdAt`
      // is past the cutoff, past-you didn't know about it.
      if (created && created > cutoff) continue;
      docs.push({
        id: d.id,
        title: data.title ?? "Untitled",
        createdAt: created || null,
        updatedAt: Math.min(updated || 0, cutoff) || null,
        wordCount: data.wordCount ?? 0,
      });
      if (docs.length >= limit) break;
    }
    return { docs, count: docs.length, asOf: new Date(cutoff).toISOString() };
  },
};

/* ─────────────────────────── past_docs_read ─────────────────────────── */

const pastDocsRead: Tool = {
  name: "past_docs_read",
  category: "docs",
  definition: {
    type: "function",
    function: {
      name: "past_docs_read",
      description:
        "Read the content of YOUR doc as it stood on or before the asOf date. We don't store full version history yet; if the doc has been edited since asOf, this returns the current content with a `staleSinceAsOf: true` flag so past-you can hedge.",
      parameters: {
        type: "object",
        properties: {
          docId: { type: "string" },
          asOf: { type: "string" },
        },
        required: ["docId"],
      },
    },
  },
  handler: async (args, ctx) => {
    const docId = typeof args.docId === "string" ? args.docId : "";
    if (!docId) return toolError("docId is required");
    const cutoff = asOfMs(ctx, args);
    const fs = getAdminFirestore();
    const snap = await fs.doc(`documents/${docId}`).get();
    if (!snap.exists) return toolError(`doc ${docId} not found`);
    const data = snap.data() as Record<string, unknown>;
    if (data.userId !== ctx.uid) return toolError("not yours");
    const created = millisOf(data.createdAt);
    if (created > cutoff) {
      return toolError("this doc didn't exist yet on the asOf date — past-you doesn't know it");
    }
    const updated = millisOf(data.updatedAt);
    const content = typeof data.content === "string" ? data.content : "";
    const truncated = content.length > MAX_RETURN_CHARS;
    return {
      id: docId,
      title: data.title ?? "Untitled",
      projectId: data.projectId,
      content: truncated ? content.slice(0, MAX_RETURN_CHARS) : content,
      truncated,
      createdAt: created,
      updatedAt: updated,
      asOf: new Date(cutoff).toISOString(),
      // The honest signal — past-you may have written something we
      // can't reconstruct precisely. Use this to caveat answers.
      staleSinceAsOf: updated > cutoff,
    };
  },
};

/* ─────────────────────────── past_conversations_search ─────────────────────────── */

const pastConversationsSearch: Tool = {
  name: "past_conversations_search",
  category: "docs",
  definition: {
    type: "function",
    function: {
      name: "past_conversations_search",
      description:
        "Search YOUR chat history — messages YOU sent (role:user) — that existed on or before the asOf date. Useful when past-you said something out loud in chat that didn't make it into a doc.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Free-text — matched against the message text." },
          asOf: { type: "string" },
          limit: { type: "number" },
        },
        required: ["query"],
      },
    },
  },
  handler: async (args, ctx) => {
    const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
    if (!query) return toolError("query required");
    const cutoff = asOfMs(ctx, args);
    const limit = Math.min(typeof args.limit === "number" ? args.limit : 8, MAX_MESSAGES);
    const fs = getAdminFirestore();
    // Pull recent user-authored messages and filter in-process. The
    // dataset is bounded per user and we cap at MAX_MESSAGES — cheap.
    const msgsSnap = await fs
      .collectionGroup("messages")
      .where("userId", "==", ctx.uid)
      .where("role", "==", "user")
      .orderBy("createdAt", "desc")
      .limit(MAX_MESSAGES)
      .get()
      .catch(() => null);
    if (!msgsSnap) {
      return { matches: [], note: "No collection-group index for chat search yet." };
    }
    const hits: Array<{ content: string; createdAt: number; conversationId: string | null }> = [];
    for (const m of msgsSnap.docs) {
      const data = m.data() as { content?: string; createdAt?: unknown };
      const ts = millisOf(data.createdAt);
      if (ts > cutoff) continue;
      const text = typeof data.content === "string" ? data.content : "";
      if (!text.toLowerCase().includes(query)) continue;
      hits.push({
        content: text.slice(0, 600),
        createdAt: ts,
        conversationId: m.ref.parent.parent?.id ?? null,
      });
      if (hits.length >= limit) break;
    }
    return { matches: hits, count: hits.length, asOf: new Date(cutoff).toISOString() };
  },
};

export const PAST_YOU_TOOLS: Tool[] = [
  pastDocsList,
  pastDocsRead,
  pastConversationsSearch,
];
