/**
 * Ingest adapters — Firestore row → `WorkspaceItem`.
 *
 * One adapter per indexable collection. Each adapter:
 *   1. Strips markup (TipTap JSON, HTML) to a flat searchable string.
 *   2. Chooses the title field appropriate to the kind.
 *   3. Caps body length so BM25 stats stay bounded (~10k tokens/item).
 *   4. Normalises the timestamp to epoch-ms so recency weighting works
 *      across collections that store time differently (Firestore
 *      Timestamp objects vs. epoch numbers).
 *
 * `loadWorkspaceItems(projectId)` is the entry point — it pulls every
 * indexable collection in parallel and returns the unified list.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  type DocumentData,
  type Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import type { WorkspaceItem } from "./types";

const MAX_BODY_CHARS = 8_000; // Cap per item — keeps BM25 stats bounded.

/* ─────────────────────────────────────────────────────────────
 *  Time + markup helpers
 * ──────────────────────────────────────────────────────────── */

function toEpochMs(t: unknown): number {
  if (typeof t === "number") return t;
  if (t && typeof t === "object" && "toMillis" in t) {
    return (t as Timestamp).toMillis();
  }
  if (typeof t === "string") {
    const parsed = Date.parse(t);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

/**
 * Strip TipTap doc JSON (or any nested {type, content, text} tree) into
 * a flat searchable string. Recurses through `content`, picks up `text`,
 * tolerates plain strings.
 */
export function stripTipTap(doc: unknown): string {
  if (typeof doc === "string") return doc;
  if (!doc || typeof doc !== "object") return "";
  const node = doc as { text?: unknown; content?: unknown };
  if (typeof node.text === "string") return node.text;
  if (Array.isArray(node.content)) {
    return node.content.map((c) => stripTipTap(c)).join(" ");
  }
  return "";
}

function clamp(s: string): string {
  if (s.length <= MAX_BODY_CHARS) return s;
  return s.slice(0, MAX_BODY_CHARS);
}

/* ─────────────────────────────────────────────────────────────
 *  Per-kind adapters
 * ──────────────────────────────────────────────────────────── */

export function adaptDocument(id: string, data: DocumentData): WorkspaceItem | null {
  if (typeof data.projectId !== "string") return null;
  const title = typeof data.title === "string" ? data.title : "Untitled";
  // TipTap content can be stored as a JSON object or as a string. Handle both.
  const body = clamp(stripTipTap(data.content) || "");
  return {
    uid: `document:${id}`,
    id,
    kind: "document",
    projectId: data.projectId,
    title,
    body,
    updatedAt: toEpochMs(data.updatedAt),
    meta: {
      wordCount: data.wordCount,
      citationCount: data.citationCount,
      verifiedCount: data.verifiedCount,
    },
  };
}

export function adaptQuery(id: string, data: DocumentData): WorkspaceItem | null {
  if (typeof data.projectId !== "string") return null;
  const queryText = typeof data.query === "string" ? data.query : "";
  const answerText = typeof data.answer === "string" ? data.answer : "";
  return {
    uid: `query:${id}`,
    id,
    kind: "query",
    projectId: data.projectId,
    title: queryText.slice(0, 120) || "Untitled query",
    body: clamp(`${queryText}\n\n${answerText}`),
    updatedAt: toEpochMs(data.createdAt ?? data.updatedAt),
    meta: {
      mode: data.mode,
      sourceCount: data.sourceCount,
      verifiedCount: data.verifiedCount,
    },
  };
}

export function adaptClaim(id: string, data: DocumentData): WorkspaceItem | null {
  if (typeof data.projectId !== "string") return null;
  if (data.retired === true) return null; // exclude retired claims from search by default
  const atomic = typeof data.atomicAssertion === "string" ? data.atomicAssertion : "";
  if (!atomic) return null;
  return {
    uid: `claim:${id}`,
    id,
    kind: "claim",
    projectId: data.projectId,
    title: atomic.slice(0, 120),
    body: clamp(atomic),
    embedding: data.embedding && Array.isArray(data.embedding.vector)
      ? data.embedding
      : undefined,
    updatedAt: toEpochMs(data.updatedAt ?? data.createdAt),
    meta: {
      polarity: data.polarity,
      sourceSupport: data.sourceSupport,
      contradictsCount: Array.isArray(data.contradicts) ? data.contradicts.length : 0,
    },
  };
}

export function adaptEpisode(id: string, data: DocumentData): WorkspaceItem | null {
  if (typeof data.projectId !== "string") return null;
  const input = typeof data.input === "string" ? data.input : "";
  const output = typeof data.output === "string" ? data.output : "";
  return {
    uid: `episode:${id}`,
    id,
    kind: "episode",
    projectId: data.projectId,
    title: input.slice(0, 120) || "Untitled episode",
    body: clamp(`${input}\n\n${output}`),
    updatedAt: toEpochMs(data.timestamp),
    meta: {
      type: data.type,
      claimCount:
        (Array.isArray(data.claimsReferenced) ? data.claimsReferenced.length : 0) +
        (Array.isArray(data.claimsCreated) ? data.claimsCreated.length : 0),
    },
  };
}

export function adaptProject(id: string, data: DocumentData): WorkspaceItem | null {
  // Projects are first-class workspace items because the command palette
  // should match a project's own name + system-instructions text.
  const name = typeof data.name === "string" ? data.name : "Untitled project";
  const instructions = typeof data.systemInstructions === "string" ? data.systemInstructions : "";
  return {
    uid: `project:${id}`,
    id,
    kind: "project",
    projectId: id,
    title: name,
    body: clamp(`${name}\n\n${instructions}`),
    updatedAt: toEpochMs(data.updatedAt),
    meta: {
      mode: data.mode,
      docCount: data.docCount,
      queryCount: data.queryCount,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 *  Loader — pulls every indexable collection in parallel.
 *
 *  Reads happen client-side via the Firestore JS SDK; security rules
 *  enforce ownership, so every query in here is implicitly scoped to
 *  the calling user's auth context. We don't add an extra `userId ==`
 *  filter because it's already enforced at the rule level and adding
 *  it client-side would require a composite index per collection.
 * ──────────────────────────────────────────────────────────── */

export interface LoadOptions {
  /** Skip kinds we don't need for a particular search shape. */
  kinds?: ReadonlyArray<WorkspaceItem["kind"]>;
}

const ALL_KINDS: ReadonlyArray<WorkspaceItem["kind"]> = [
  "project",
  "document",
  "query",
  "claim",
  "episode",
];

export async function loadWorkspaceItems(
  projectId: string,
  opts: LoadOptions = {},
): Promise<WorkspaceItem[]> {
  const wantKinds = new Set<WorkspaceItem["kind"]>(opts.kinds ?? ALL_KINDS);

  const tasks: Array<Promise<WorkspaceItem[]>> = [];

  if (wantKinds.has("project")) {
    tasks.push(
      (async () => {
        const snap = await getDoc(doc(db, "projects", projectId));
        if (!snap.exists()) return [];
        const item = adaptProject(snap.id, snap.data());
        return item ? [item] : [];
      })(),
    );
  }

  if (wantKinds.has("document")) {
    tasks.push(
      getDocs(query(collection(db, "documents"), where("projectId", "==", projectId)))
        .then((snap) =>
          snap.docs
            .map((d) => adaptDocument(d.id, d.data()))
            .filter((x): x is WorkspaceItem => x !== null),
        )
        .catch(() => []), // missing index → degrade silently rather than crash search
    );
  }

  if (wantKinds.has("query")) {
    tasks.push(
      getDocs(query(collection(db, "queries"), where("projectId", "==", projectId)))
        .then((snap) =>
          snap.docs
            .map((d) => adaptQuery(d.id, d.data()))
            .filter((x): x is WorkspaceItem => x !== null),
        )
        .catch(() => []),
    );
  }

  if (wantKinds.has("claim")) {
    tasks.push(
      getDocs(query(collection(db, "veritasClaims"), where("projectId", "==", projectId)))
        .then((snap) =>
          snap.docs
            .map((d) => adaptClaim(d.id, d.data()))
            .filter((x): x is WorkspaceItem => x !== null),
        )
        .catch(() => []),
    );
  }

  if (wantKinds.has("episode")) {
    tasks.push(
      getDocs(query(collection(db, "veritasEpisodes"), where("projectId", "==", projectId)))
        .then((snap) =>
          snap.docs
            .map((d) => adaptEpisode(d.id, d.data()))
            .filter((x): x is WorkspaceItem => x !== null),
        )
        .catch(() => []),
    );
  }

  const results = await Promise.all(tasks);
  return results.flat();
}
