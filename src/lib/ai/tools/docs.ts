/**
 * Document tools — read / create / update Forge documents.
 *
 * The agent can:
 *   • list the docs in a project (with titles + word counts)
 *   • read full content of a doc (HTML, capped)
 *   • create a new doc with content
 *   • patch a doc (replace, append, or prepend content)
 *
 * Writes happen through the admin Firestore SDK and stamp
 * `source: "agent"` so the UI can surface which docs originated from
 * the assistant vs. the user.
 *
 * Document content lives in /documents/{id} (flat collection,
 * scoped by userId + projectId — see src/lib/firebase/firestore.ts).
 */

import "server-only";
import { randomUUID } from "node:crypto";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import type { Tool, ToolContext } from "./types";
import { toolError } from "./types";

const MAX_RETURN_CHARS = 8_000;

function ensureProject(ctx: ToolContext, args: Record<string, unknown>): string | null {
  const explicit = typeof args.projectId === "string" ? args.projectId : null;
  return explicit ?? ctx.projectId;
}

function countWords(text: string): number {
  const t = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return t ? t.split(/\s+/).length : 0;
}

/* ─────────────────────────── list ─────────────────────────── */

const listDocs: Tool = {
  name: "docs_list",
  category: "docs",
  definition: {
    type: "function",
    function: {
      name: "docs_list",
      description:
        "List documents in a project. Returns titles, ids, word counts, and updatedAt — NOT full content (use docs_read for that).",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          limit: { type: "number", description: "Max docs to return (default 20, hard cap 50)." },
        },
        required: [],
      },
    },
  },
  handler: async (args, ctx) => {
    const projectId = ensureProject(ctx, args);
    if (!projectId) return toolError("No active project — pass projectId explicitly.");
    const limit = Math.min(typeof args.limit === "number" ? args.limit : 20, 50);
    const fs = getAdminFirestore();
    const snap = await fs
      .collection("documents")
      .where("userId", "==", ctx.uid)
      .where("projectId", "==", projectId)
      .orderBy("updatedAt", "desc")
      .limit(limit)
      .get();
    return {
      docs: snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          title: data.title ?? "Untitled",
          wordCount: data.wordCount ?? 0,
          parentId: data.parentId ?? null,
          updatedAt: data.updatedAt ?? null,
        };
      }),
      count: snap.size,
    };
  },
};

/* ─────────────────────────── read ─────────────────────────── */

const readDoc: Tool = {
  name: "docs_read",
  category: "docs",
  definition: {
    type: "function",
    function: {
      name: "docs_read",
      description:
        "Read the full HTML content of one document. Content is capped at 8000 chars; if truncated, the response notes it.",
      parameters: {
        type: "object",
        properties: { docId: { type: "string" } },
        required: ["docId"],
      },
    },
  },
  handler: async (args, ctx) => {
    const docId = typeof args.docId === "string" ? args.docId : "";
    if (!docId) return toolError("docId is required");
    const fs = getAdminFirestore();
    const snap = await fs.doc(`documents/${docId}`).get();
    if (!snap.exists) return toolError(`doc ${docId} not found`);
    const data = snap.data() as Record<string, unknown>;
    if (data.userId !== ctx.uid) return toolError("not authorised to read this doc");
    const content = typeof data.content === "string" ? data.content : "";
    const truncated = content.length > MAX_RETURN_CHARS;
    return {
      id: docId,
      title: data.title ?? "Untitled",
      projectId: data.projectId,
      content: truncated ? content.slice(0, MAX_RETURN_CHARS) : content,
      truncated,
      wordCount: data.wordCount ?? 0,
    };
  },
};

/* ─────────────────────────── create ─────────────────────────── */

const createDoc: Tool = {
  name: "docs_create",
  category: "docs",
  definition: {
    type: "function",
    function: {
      name: "docs_create",
      description:
        "Create a new document in a project. Content should be valid HTML (use <p>, <h1>-<h3>, <ul>, <ol>, <li>, <strong>, <em>, <blockquote>, <pre>, <code>, <a>).",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          content: { type: "string", description: "HTML body." },
          parentId: { type: "string", description: "Optional parent doc id for nesting." },
          projectId: { type: "string" },
        },
        required: ["title", "content"],
      },
    },
  },
  handler: async (args, ctx) => {
    const projectId = ensureProject(ctx, args);
    if (!projectId) return toolError("No active project — pass projectId explicitly.");
    const title = typeof args.title === "string" ? args.title : "";
    const content = typeof args.content === "string" ? args.content : "";
    if (!title || !content) return toolError("title and content are required");
    const fs = getAdminFirestore();
    const ref = fs.collection("documents").doc();
    await ref.set({
      userId: ctx.uid,
      projectId,
      title,
      content,
      wordCount: countWords(content),
      citationCount: 0,
      verifiedCount: 0,
      parentId: typeof args.parentId === "string" ? args.parentId : null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      source: "agent",
    });
    return { ok: true, id: ref.id, title, wordCount: countWords(content) };
  },
};

/* ─────────────────────────── update ─────────────────────────── */

const updateDoc: Tool = {
  name: "docs_update",
  category: "docs",
  definition: {
    type: "function",
    function: {
      name: "docs_update",
      description:
        "Modify an existing document. mode=replace overwrites the whole body; mode=append/prepend adds at the end/start. Always returns a diff summary.",
      parameters: {
        type: "object",
        properties: {
          docId: { type: "string" },
          mode: {
            type: "string",
            enum: ["replace", "append", "prepend"],
            description: "How to combine new content with the existing body.",
          },
          content: { type: "string", description: "HTML to write." },
          title: { type: "string", description: "Optional title rename." },
        },
        required: ["docId", "mode", "content"],
      },
    },
  },
  handler: async (args, ctx) => {
    const docId = typeof args.docId === "string" ? args.docId : "";
    const mode = typeof args.mode === "string" ? args.mode : "";
    const content = typeof args.content === "string" ? args.content : "";
    if (!docId || !mode || !content) {
      return toolError("docId, mode, content required");
    }
    if (!["replace", "append", "prepend"].includes(mode)) {
      return toolError("mode must be replace | append | prepend");
    }
    const fs = getAdminFirestore();
    const ref = fs.doc(`documents/${docId}`);
    const snap = await ref.get();
    if (!snap.exists) return toolError(`doc ${docId} not found`);
    const data = snap.data() as Record<string, unknown>;
    if (data.userId !== ctx.uid) return toolError("not authorised to update this doc");

    const oldContent = typeof data.content === "string" ? data.content : "";
    let next: string;
    if (mode === "replace") next = content;
    else if (mode === "append") next = oldContent + content;
    else next = content + oldContent;

    await ref.set(
      {
        content: next,
        wordCount: countWords(next),
        ...(typeof args.title === "string" ? { title: args.title } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return {
      ok: true,
      id: docId,
      mode,
      diff: {
        beforeChars: oldContent.length,
        afterChars: next.length,
        delta: next.length - oldContent.length,
        beforeWords: countWords(oldContent),
        afterWords: countWords(next),
      },
    };
  },
};

export const DOC_TOOLS: Tool[] = [listDocs, readDoc, createDoc, updateDoc];
