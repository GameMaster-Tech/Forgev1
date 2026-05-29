/**
 * POST /api/integrations/notion/sync
 *
 * Pull the user's entire visible Notion workspace into Forge:
 *
 *   1. Resolve a fresh bearer token (refreshes if Notion ever rotates).
 *   2. Enumerate every page + database the bot can see (`/v1/search`,
 *      no filter — Notion only returns what the user shared during
 *      OAuth, so this is naturally scoped).
 *   3. Build a parent → children tree from the workspace.
 *   4. Top-level workspace-parented pages each become a Forge project.
 *      Nested pages become Forge documents under that project.
 *   5. Databases:
 *        • If the schema has a `date` property → treat each row as a
 *          Forge calendar event (`users/{uid}/google_events/{id}`
 *          — same collection the Google sync uses so the calendar
 *          grid surfaces them without a second bridge; rows are
 *          tagged `externalSource: "notion"`).
 *        • Otherwise → render as a single Forge document that lists
 *          every row.
 *   6. For every page we sync, fetch its block children (one level
 *      deep, plus one nested level for lists/toggles) and convert to
 *      TipTap HTML.
 *   7. Persist a per-page sync row at
 *      `users/{uid}/notion_pages/{pageId}` mapping Notion → Forge ids
 *      so a re-sync upserts instead of duplicating.
 *
 * Caps:
 *   • MAX_PAGES        — search() ceiling (Notion paginates)
 *   • MAX_PROJECTS     — top-level pages we'll create projects for
 *   • MAX_DB_ROWS      — per-database row ceiling
 *   • MAX_NESTED_DEPTH — block recursion cap (defends against cycles)
 *
 * Server-only. Single Notion connection per user. Long-running — uses
 * the Node runtime, not Edge.
 */

import { NextResponse, type NextRequest } from "next/server";
import { verifyRequest } from "@/lib/server/auth";
import {
  ensureFreshNotionToken,
  getDatabase,
  listBlockChildren,
  NotionApiError,
  queryDatabase,
  searchAll,
} from "@/lib/server/notion-api";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import type {
  NotionBlock,
  NotionDatabase,
  NotionIntegrationDoc,
  NotionPage,
  NotionPageSyncRow,
  NotionSyncStats,
} from "@/lib/integrations/notion/types";
import { blocksToHtml, pageTitle } from "@/lib/integrations/notion/convert";
import { log } from "@/lib/observability";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 min — heavy workspaces take time.

const MAX_PAGES = intFromEnv("NOTION_SYNC_MAX_ITEMS", 2_000);
const MAX_PROJECTS = intFromEnv("NOTION_SYNC_MAX_PROJECTS", 200);
const MAX_DB_ROWS = intFromEnv("NOTION_SYNC_MAX_DB_ROWS", 1_000);
const MAX_PAGE_BLOCKS = intFromEnv("NOTION_SYNC_MAX_PAGE_BLOCKS", 1_000);
const MAX_NESTED_DEPTH = intFromEnv("NOTION_SYNC_MAX_NESTED_DEPTH", 4);

function intFromEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

interface RowDataBase {
  userId: string;
  projectId: string;
  notionPageId: string;
  notionLastEditedTime: string;
  source: "notion";
}

export async function POST(req: NextRequest): Promise<Response> {
  const verified = await verifyRequest(req);
  if (!verified) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  // Narrow into a local const so callbacks below see the non-null uid
  // without TypeScript re-widening on the async function boundary.
  const uid = verified.uid;

  const t0 = Date.now();
  const fs = getAdminFirestore();
  const intRef = fs.doc(`users/${uid}/integrations/notion`);

  let token: string;
  try {
    token = await ensureFreshNotionToken(uid);
  } catch (err) {
    const kind = err instanceof NotionApiError ? err.kind : "fatal";
    return NextResponse.json(
      { ok: false, error: kind === "revoked" ? "Notion access expired. Reconnect." : "Notion not connected." },
      { status: kind === "unauthenticated" ? 401 : kind === "revoked" ? 410 : 500 },
    );
  }

  // 1. Pull everything the bot can see.
  let results;
  try {
    results = await searchAll(token, MAX_PAGES);
  } catch (err) {
    await intRef.set(
      {
        lastError: {
          code: err instanceof NotionApiError ? err.kind : "fatal",
          at: Date.now(),
          message: err instanceof Error ? err.message : "search failed",
        },
      } as Partial<NotionIntegrationDoc>,
      { merge: true },
    );
    log.error(err, { route: "notion.sync.search", uid: uid });
    return NextResponse.json({ ok: false, error: "Notion search failed" }, { status: 502 });
  }

  // Partition into pages vs databases, and build a parent index.
  const pages: NotionPage[] = [];
  const databases: NotionDatabase[] = [];
  for (const r of results) {
    if (r.object === "page" && !r.archived && !r.in_trash) pages.push(r);
    else if (r.object === "database" && !r.archived && !r.in_trash) databases.push(r);
  }

  // 2. Figure out top-level "project" pages: workspace-parented pages,
  //    OR pages whose parent isn't in our visible set (root of a
  //    sub-tree the bot can see).
  const visiblePageIds = new Set(pages.map((p) => p.id));
  const visibleDatabaseIds = new Set(databases.map((d) => d.id));
  const topLevel = pages.filter((p) => {
    if (p.parent.type === "workspace") return true;
    if (p.parent.type === "page_id") return !visiblePageIds.has(p.parent.page_id);
    if (p.parent.type === "database_id") return !visibleDatabaseIds.has(p.parent.database_id);
    return false;
  });

  // Sort newest first so the most active workspace areas become
  // projects when we hit the MAX_PROJECTS cap.
  topLevel.sort(
    (a, b) => Date.parse(b.last_edited_time) - Date.parse(a.last_edited_time),
  );
  const projectPages = topLevel.slice(0, MAX_PROJECTS);

  // 3. Resolve / create one Forge project per top-level page.
  const projectByNotionRoot = new Map<string, string>();
  const stats: NotionSyncStats = {
    scannedPages: pages.length,
    scannedDatabases: databases.length,
    createdProjects: 0,
    upsertedDocuments: 0,
    upsertedEvents: 0,
    upsertedDataTables: 0,
    archivedDocuments: 0,
    durationMs: 0,
  };
  const seenSyncIds = new Set<string>();

  for (const root of projectPages) {
    const title = pageTitle(root.properties);
    const projectId = await upsertProject({
      uid: uid,
      notionRootId: root.id,
      title,
      lastEditedTime: root.last_edited_time,
    });
    seenSyncIds.add(root.id);
    projectByNotionRoot.set(root.id, projectId);
  }

  // Stand-in project for orphan pages (pages whose root wasn't chosen
  // because of MAX_PROJECTS, or pages whose visible parent chain
  // doesn't reach a known root). Created lazily.
  let fallbackProjectId: string | null = null;
  async function fallbackProject(): Promise<string> {
    if (fallbackProjectId) return fallbackProjectId;
    fallbackProjectId = await upsertProject({
      uid: uid,
      notionRootId: "notion-misc",
      title: "Notion · everything else",
      lastEditedTime: new Date().toISOString(),
    });
    seenSyncIds.add("notion-misc");
    return fallbackProjectId;
  }

  // Map every page id → owning project id. Walk parents until we land
  // on a chosen root.
  const pageById = new Map(pages.map((p) => [p.id, p]));
  const databaseById = new Map(databases.map((d) => [d.id, d]));
  const projectByPageId = new Map<string, string>();
  const projectByDatabaseId = new Map<string, string>();

  function resolveProject(pageId: string, seen = new Set<string>()): string | null {
    if (seen.has(pageId)) return null;
    seen.add(pageId);
    if (projectByNotionRoot.has(pageId)) return projectByNotionRoot.get(pageId)!;
    if (projectByPageId.has(pageId)) return projectByPageId.get(pageId)!;
    const page = pageById.get(pageId);
    if (!page) return null;
    if (page.parent.type === "page_id") {
      const parentResolved = resolveProject(page.parent.page_id, seen);
      if (parentResolved) {
        projectByPageId.set(pageId, parentResolved);
        return parentResolved;
      }
    }
    if (page.parent.type === "database_id") {
      const dbResolved = resolveDatabaseProject(page.parent.database_id, seen);
      if (dbResolved) {
        projectByPageId.set(pageId, dbResolved);
        return dbResolved;
      }
    }
    return null;
  }

  function resolveDatabaseProject(databaseId: string, seen = new Set<string>()): string | null {
    if (seen.has(databaseId)) return null;
    seen.add(databaseId);
    if (projectByDatabaseId.has(databaseId)) return projectByDatabaseId.get(databaseId)!;
    const db = databaseById.get(databaseId);
    if (!db) return null;
    let resolved: string | null = null;
    if (db.parent.type === "page_id") {
      resolved = resolveProject(db.parent.page_id);
    } else if (db.parent.type === "database_id") {
      resolved = resolveDatabaseProject(db.parent.database_id, seen);
    }
    if (resolved) projectByDatabaseId.set(databaseId, resolved);
    return resolved;
  }

  // 4. Sync every non-database page as a Forge document.
  for (const page of pages) {
    const pid = resolveProject(page.id);
    const ownerProjectId = pid ?? (await fallbackProject());
    try {
      await upsertPageDocument({
        uid: uid,
        projectId: ownerProjectId,
        page,
        token,
      });
      seenSyncIds.add(page.id);
      stats.upsertedDocuments += 1;
    } catch (err) {
      log.error(err, { route: "notion.sync.page", uid: uid, pageId: page.id });
    }
  }

  // 5. Sync databases.
  for (const db of databases) {
    const dbParentPageId = db.parent.type === "page_id" ? db.parent.page_id : null;
    const ownerProjectId = dbParentPageId
      ? resolveProject(dbParentPageId) ?? (await fallbackProject())
      : await fallbackProject();
    try {
      const dbStats = await syncDatabase({
        uid: uid,
        projectId: ownerProjectId,
        db,
        token,
        seenSyncIds,
      });
      stats.upsertedEvents += dbStats.events;
      stats.upsertedDataTables += dbStats.tables;
      stats.upsertedDocuments += dbStats.documents;
    } catch (err) {
      log.error(err, { route: "notion.sync.db", uid: uid, dbId: db.id });
    }
  }

  stats.createdProjects = projectByNotionRoot.size + (fallbackProjectId ? 1 : 0);
  stats.archivedDocuments = await archiveMissingNotionRows(uid, seenSyncIds);
  stats.durationMs = Date.now() - t0;

  await intRef.set(
    {
      lastSyncedAt: Date.now(),
      stats: {
        projects: stats.createdProjects,
        documents: stats.upsertedDocuments,
        events: stats.upsertedEvents,
        databases: stats.scannedDatabases,
      },
      lastError: FieldValue.delete() as unknown as undefined,
    } as Partial<NotionIntegrationDoc>,
    { merge: true },
  );

  log.event("notion.sync", {
    userId: uid,
    ...stats,
  });

  return NextResponse.json({ ok: true, ...stats });
}

/* ─────────────────────────── Project upsert ─────────────────────────── */

async function upsertProject(args: {
  uid: string;
  notionRootId: string;
  title: string;
  lastEditedTime: string;
}): Promise<string> {
  const fs = getAdminFirestore();
  // Deterministic project id derived from the Notion root, so re-syncs
  // converge instead of forking.
  const projectId = `notion_${args.notionRootId.replace(/-/g, "")}`.slice(0, 40);
  const ref = fs.doc(`projects/${projectId}`);
  const snap = await ref.get();
  if (snap.exists) {
    await ref.set(
      {
        name: args.title,
        updatedAt: FieldValue.serverTimestamp(),
        notionRootId: args.notionRootId,
        notionLastEditedTime: args.lastEditedTime,
      },
      { merge: true },
    );
  } else {
    await ref.set({
      userId: args.uid,
      name: args.title,
      mode: "reasoning",
      systemInstructions: "",
      queryCount: 0,
      docCount: 0,
      status: "active",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      notionRootId: args.notionRootId,
      notionLastEditedTime: args.lastEditedTime,
      source: "notion",
    });
  }
  await fs.doc(`users/${args.uid}/notion_pages/${args.notionRootId}`).set(
    {
      pageId: args.notionRootId,
      parentId: null,
      kind: "project_root",
      forgeProjectId: projectId,
      forgeDocumentId: null,
      title: args.title,
      lastEditedTime: args.lastEditedTime,
      syncedAt: Date.now(),
      archived: false,
    } satisfies NotionPageSyncRow,
    { merge: true },
  );
  return projectId;
}

/* ─────────────────────────── Page → Document ─────────────────────────── */

async function upsertPageDocument(args: {
  uid: string;
  projectId: string;
  page: NotionPage;
  token: string;
}): Promise<void> {
  const fs = getAdminFirestore();
  const title = pageTitle(args.page.properties);
  const html = await renderPageHtml(args.token, args.page.id);

  // Map Notion pageId → Forge docId via the sync row.
  const syncRef = fs.doc(`users/${args.uid}/notion_pages/${args.page.id}`);
  const syncSnap = await syncRef.get();
  let docId = (syncSnap.data() as NotionPageSyncRow | undefined)?.forgeDocumentId ?? null;

  if (docId) {
    await fs.doc(`documents/${docId}`).set(
      {
        title,
        content: html,
        wordCount: countWords(html),
        status: "active",
        archived: false,
        updatedAt: FieldValue.serverTimestamp(),
        notionPageId: args.page.id,
        notionLastEditedTime: args.page.last_edited_time,
        notionUrl: args.page.url,
        source: "notion",
      },
      { merge: true },
    );
  } else {
    const docRef = fs.collection("documents").doc();
    docId = docRef.id;
    await docRef.set({
      userId: args.uid,
      projectId: args.projectId,
      title,
      content: html,
      wordCount: countWords(html),
      citationCount: 0,
      verifiedCount: 0,
      parentId: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      notionPageId: args.page.id,
      notionLastEditedTime: args.page.last_edited_time,
      notionUrl: args.page.url,
      status: "active",
      archived: false,
      source: "notion",
    });
  }

  await syncRef.set(
    {
      pageId: args.page.id,
      parentId:
        args.page.parent.type === "page_id" ? args.page.parent.page_id : null,
      kind: "page",
      forgeProjectId: args.projectId,
      forgeDocumentId: docId,
      title,
      lastEditedTime: args.page.last_edited_time,
      syncedAt: Date.now(),
      archived: args.page.archived,
    } satisfies NotionPageSyncRow,
    { merge: true },
  );
}

async function renderPageHtml(token: string, pageId: string): Promise<string> {
  const root = await listBlockChildren(token, pageId, MAX_PAGE_BLOCKS).catch(() => []);
  if (root.length === 0) return "";
  const childrenByParent = new Map<string, NotionBlock[]>();
  // One extra recursion for blocks marked has_children (lists, toggles,
  // quotes). Capped by MAX_NESTED_DEPTH so a deeply nested workspace
  // doesn't blow the budget.
  await fetchNested(token, root, childrenByParent, 1);
  return blocksToHtml(root, { childrenByParent });
}

async function fetchNested(
  token: string,
  blocks: NotionBlock[],
  childrenByParent: Map<string, NotionBlock[]>,
  depth: number,
): Promise<void> {
  if (depth > MAX_NESTED_DEPTH) return;
  const needsKids = blocks.filter((b) => b.has_children);
  if (needsKids.length === 0) return;
  await Promise.allSettled(
    needsKids.map(async (b) => {
      try {
        const kids = await listBlockChildren(token, b.id, 200);
        childrenByParent.set(b.id, kids);
        await fetchNested(token, kids, childrenByParent, depth + 1);
      } catch {
        /* one missing branch shouldn't sink the whole page */
      }
    }),
  );
}

/* ─────────────────────────── Database sync ─────────────────────────── */

async function syncDatabase(args: {
  uid: string;
  projectId: string;
  db: NotionDatabase;
  token: string;
  seenSyncIds: Set<string>;
}): Promise<{ events: number; tables: number; documents: number }> {
  // Some databases come back without expanded schema in `search`;
  // fetch the full definition once.
  let database = args.db;
  try {
    database = await getDatabase(args.token, args.db.id);
  } catch {
    /* fall back to the search payload */
  }

  const dateProps = Object.entries(database.properties).filter(
    ([, def]) => def.type === "date",
  );
  const titleString = database.title.map((r) => r.plain_text).join("").trim() || "Untitled database";

  // Cap the query — workspaces with massive databases shouldn't lock
  // the whole sync.
  const rows = await queryDatabase(args.token, database.id, MAX_DB_ROWS).catch(
    () => [] as NotionPage[],
  );
  args.seenSyncIds.add(database.id);

  if (dateProps.length > 0) {
    // Calendar database → write each row as a calendar event in the
    // same collection the Google Calendar sync uses. CalendarProvider
    // picks them up automatically via subscribeGoogleEvents, which
    // now filters on externalSource so both sources can coexist.
    const dateKey = dateProps[0][0];
    let events = 0;
    let documents = 0;
    for (const row of rows) {
      if (row.archived || row.in_trash) continue;
      if (!args.seenSyncIds.has(row.id)) {
        await upsertPageDocument({
          uid: args.uid,
          projectId: args.projectId,
          page: row,
          token: args.token,
        });
        documents += 1;
      }
      args.seenSyncIds.add(row.id);
      const date = row.properties[dateKey]?.date;
      if (!date?.start) continue;
      await upsertNotionEvent({
        uid: args.uid,
        projectId: args.projectId,
        dbId: database.id,
        dbTitle: titleString,
        row,
        date,
      });
      events += 1;
    }
    return { events, tables: 0, documents };
  }

  let documents = 0;
  for (const row of rows) {
    if (row.archived || row.in_trash) continue;
    if (!args.seenSyncIds.has(row.id)) {
      await upsertPageDocument({
        uid: args.uid,
        projectId: args.projectId,
        page: row,
        token: args.token,
      });
      documents += 1;
    }
    args.seenSyncIds.add(row.id);
  }

  // Non-date database → render as a single Forge document with a
  // bulleted list of rows. Each row links back to its Notion URL.
  const html = renderDatabaseAsList(titleString, rows);
  await upsertDatabaseDocument({
    uid: args.uid,
    projectId: args.projectId,
    dbId: database.id,
    title: titleString,
    html,
    lastEditedTime: database.last_edited_time,
  });
  return { events: 0, tables: 1, documents };
}

async function upsertNotionEvent(args: {
  uid: string;
  projectId: string;
  dbId: string;
  dbTitle: string;
  row: NotionPage;
  date: NonNullable<NotionPage["properties"][string]["date"]>;
}): Promise<void> {
  const fs = getAdminFirestore();
  const title = pageTitle(args.row.properties) || args.dbTitle;
  const { start, end, allDay, timeZone } = normalizeNotionDate(args.date);

  // Deterministic event id so re-syncs upsert rather than duplicating.
  const eventId = `notion_${args.row.id.replace(/-/g, "")}`.slice(0, 60);
  const ref = fs.doc(`users/${args.uid}/google_events/${eventId}`);
  const body: RowDataBase & {
    id: string;
    title: string;
    start: string;
    end: string;
    eventKind: string;
    externalSource: "notion";
    externalId: string;
    description?: string;
    allDay: boolean;
    timeZone?: string;
    notionDbId: string;
    notionDbTitle: string;
  } = {
    id: eventId,
    userId: args.uid,
    projectId: args.projectId,
    notionPageId: args.row.id,
    notionLastEditedTime: args.row.last_edited_time,
    source: "notion",
    title,
    start,
    end,
    allDay,
    eventKind: "meeting",
    externalSource: "notion",
    externalId: args.row.id,
    notionDbId: args.dbId,
    notionDbTitle: args.dbTitle,
  };
  if (timeZone) body.timeZone = timeZone;
  if (args.row.url) body.description = `Imported from Notion · ${args.row.url}`;
  await ref.set(body, { merge: true });
  const syncRef = fs.doc(`users/${args.uid}/notion_pages/${args.row.id}`);
  const existingSync = (await syncRef.get()).data() as NotionPageSyncRow | undefined;
  await syncRef.set(
    {
      pageId: args.row.id,
      parentId: args.dbId,
      kind: "database_row",
      forgeProjectId: args.projectId,
      forgeDocumentId: existingSync?.forgeDocumentId ?? null,
      forgeEventId: eventId,
      title,
      lastEditedTime: args.row.last_edited_time,
      syncedAt: Date.now(),
      archived: args.row.archived || args.row.in_trash,
    } satisfies NotionPageSyncRow,
    { merge: true },
  );
}

async function upsertDatabaseDocument(args: {
  uid: string;
  projectId: string;
  dbId: string;
  title: string;
  html: string;
  lastEditedTime: string;
}): Promise<void> {
  const fs = getAdminFirestore();
  const syncRef = fs.doc(`users/${args.uid}/notion_pages/${args.dbId}`);
  const syncSnap = await syncRef.get();
  let docId = (syncSnap.data() as NotionPageSyncRow | undefined)?.forgeDocumentId ?? null;

  if (docId) {
    await fs.doc(`documents/${docId}`).set(
      {
        title: args.title,
        content: args.html,
        wordCount: countWords(args.html),
        status: "active",
        archived: false,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  } else {
    const docRef = fs.collection("documents").doc();
    docId = docRef.id;
    await docRef.set({
      userId: args.uid,
      projectId: args.projectId,
      title: args.title,
      content: args.html,
      wordCount: countWords(args.html),
      citationCount: 0,
      verifiedCount: 0,
      parentId: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      notionPageId: args.dbId,
      notionLastEditedTime: args.lastEditedTime,
      status: "active",
      archived: false,
      source: "notion-database",
    });
  }
  await syncRef.set(
    {
      pageId: args.dbId,
      parentId: null,
      kind: "database",
      forgeProjectId: args.projectId,
      forgeDocumentId: docId,
      title: args.title,
      lastEditedTime: args.lastEditedTime,
      syncedAt: Date.now(),
      archived: false,
    } satisfies NotionPageSyncRow,
    { merge: true },
  );
}

async function archiveMissingNotionRows(
  uid: string,
  seenSyncIds: Set<string>,
): Promise<number> {
  const fs = getAdminFirestore();
  const snap = await fs.collection(`users/${uid}/notion_pages`).get();
  let archived = 0;
  let batch = fs.batch();
  let writes = 0;

  async function commitIfNeeded(force = false) {
    if (writes === 0 || (!force && writes < 400)) return;
    await batch.commit();
    batch = fs.batch();
    writes = 0;
  }

  for (const docSnap of snap.docs) {
    const row = docSnap.data() as NotionPageSyncRow;
    if (row.archived || seenSyncIds.has(docSnap.id)) continue;

    batch.set(
      docSnap.ref,
      {
        archived: true,
        syncedAt: Date.now(),
        archivedAt: Date.now(),
      },
      { merge: true },
    );
    writes += 1;

    if (row.forgeDocumentId) {
      batch.set(
        fs.doc(`documents/${row.forgeDocumentId}`),
        {
          status: "archived",
          archived: true,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      writes += 1;
      archived += 1;
    }

    if (row.forgeEventId) {
      batch.set(
        fs.doc(`users/${uid}/google_events/${row.forgeEventId}`),
        {
          archived: true,
          status: "cancelled",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      writes += 1;
    }

    if (row.kind === "project_root") {
      batch.set(
        fs.doc(`projects/${row.forgeProjectId}`),
        {
          status: "archived",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      writes += 1;
    }

    await commitIfNeeded();
  }

  await commitIfNeeded(true);
  return archived;
}

function renderDatabaseAsList(title: string, rows: NotionPage[]): string {
  const items = rows
    .filter((r) => !r.archived)
    .map((r) => {
      const t = pageTitle(r.properties) || "Untitled";
      const href = r.url ? ` (<a href="${r.url}">open in Notion</a>)` : "";
      return `<li><p>${escapeHtml(t)}${href}</p></li>`;
    })
    .join("");
  return `<h2>${escapeHtml(title)}</h2><p><em>${rows.length} row${rows.length === 1 ? "" : "s"} synced from Notion.</em></p><ul>${items}</ul>`;
}

/* ─────────────────────────── helpers ─────────────────────────── */

function normalizeNotionDate(
  date: NonNullable<NotionPage["properties"][string]["date"]>,
): { start: string; end: string; allDay: boolean; timeZone?: string } {
  const allDay = isDateOnly(date.start);
  const start = date.start;
  const end = date.end ?? defaultNotionEnd(date.start, allDay);
  return {
    start,
    end,
    allDay,
    ...(date.time_zone ? { timeZone: date.time_zone } : {}),
  };
}

function defaultNotionEnd(start: string, allDay: boolean): string {
  if (!allDay) return start;
  const parsed = new Date(`${start}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return start;
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function countWords(html: string): number {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return 0;
  return text.split(/\s+/).length;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
