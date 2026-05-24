/**
 * Notion integration — shared domain types.
 *
 * Everything that lives on disk (Firestore + encrypted blobs) is
 * declared here so the OAuth code, the API client, the sync route,
 * and the UI all agree on shape.
 *
 * Server-only? No — the *types* are safe to import from anywhere.
 * Anything that touches the access token must live under
 * `src/lib/server/` or import "server-only" itself.
 */

import type { EncryptedBlob } from "@/lib/server/crypto";

/* ─────────────────────────── persisted ─────────────────────────── */

export type NotionIntegrationStatus = "connected" | "disconnected" | "revoked";

export interface NotionAccount {
  /** Notion workspace id this token grants access to. */
  workspaceId: string;
  /** Display name of the workspace. */
  workspaceName: string;
  /** Optional workspace icon emoji / URL. */
  workspaceIcon?: string | null;
  /** Bot user id created by the integration. */
  botId: string;
  /** Owner display name + email, when available. */
  ownerName?: string | null;
  ownerEmail?: string | null;
}

/**
 * Persisted at `users/{uid}/integrations/notion`. Mirrors the shape
 * of the Google integration doc — server reads/writes only.
 */
export interface NotionIntegrationDoc {
  status: NotionIntegrationStatus;
  account?: NotionAccount;
  /** Encrypted long-lived bearer token. Notion's internal-integration
   * tokens don't expire; public OAuth tokens may include a refresh
   * token (new API). We keep both shapes encrypted. */
  accessTokenEncrypted?: EncryptedBlob;
  refreshTokenEncrypted?: EncryptedBlob;
  /** Optional explicit expiry (ms epoch). Notion may set this when
   * issuing rotating tokens via the OAuth2 token endpoint. */
  accessTokenExpiresAt?: number;
  scopes?: string[];
  connectedAt?: number;
  lastSyncedAt?: number;
  /** Cursor returned from the previous `search` call so a re-sync can
   * resume from where the last one stopped (Notion paginates). */
  searchCursor?: string | null;
  /** Counters surfaced in the UI — purely informational. */
  stats?: {
    projects: number;
    documents: number;
    events: number;
    databases: number;
  };
  lastError?: { code: string; at: number; message: string };
}

/* ─────────────────────────── sync state ────────────────────────── */

/**
 * One row per synced Notion page at
 * `users/{uid}/notion_pages/{pageId}`. Lets us re-sync incrementally
 * and clean up Forge docs when Notion pages are archived upstream.
 *
 * pageId — Notion page UUID (string, hyphenated).
 * forgeProjectId / forgeDocumentId — what we created in Firestore for
 * this page.
 * lastEditedTime — Notion's `last_edited_time` for cheap drift detect.
 * kind — `page` (regular page → Forge document), `project_root`
 * (top-level page mapped to a Forge project), `database` (mapped to a
 * DataTable doc), `database_row` (mapped to either a doc or an event
 * depending on schema).
 */
export interface NotionPageSyncRow {
  pageId: string;
  parentId?: string | null;
  kind: "page" | "project_root" | "database" | "database_row";
  forgeProjectId: string;
  forgeDocumentId?: string | null;
  forgeEventId?: string | null;
  title: string;
  lastEditedTime: string;
  syncedAt: number;
  archived?: boolean;
}

/* ─────────────────────────── api shapes ────────────────────────── */

/** Subset of the Notion `Page` object we care about. */
export interface NotionPage {
  id: string;
  object: "page";
  parent: NotionParent;
  properties: Record<string, NotionProperty>;
  url: string;
  icon?: NotionIcon | null;
  cover?: NotionCover | null;
  created_time: string;
  last_edited_time: string;
  archived: boolean;
  in_trash?: boolean;
}

/** Subset of the Notion `Database` object we care about. */
export interface NotionDatabase {
  id: string;
  object: "database";
  parent: NotionParent;
  title: NotionRichText[];
  properties: Record<string, NotionPropertyDefinition>;
  url: string;
  icon?: NotionIcon | null;
  cover?: NotionCover | null;
  created_time: string;
  last_edited_time: string;
  archived: boolean;
  in_trash?: boolean;
}

export type NotionSearchResult = NotionPage | NotionDatabase;

export type NotionParent =
  | { type: "workspace"; workspace: true }
  | { type: "page_id"; page_id: string }
  | { type: "database_id"; database_id: string }
  | { type: "block_id"; block_id: string };

export interface NotionIcon {
  type: "emoji" | "external" | "file";
  emoji?: string;
  external?: { url: string };
  file?: { url: string };
}

export interface NotionCover {
  type: "external" | "file";
  external?: { url: string };
  file?: { url: string };
}

export interface NotionRichText {
  type: "text" | "mention" | "equation";
  plain_text: string;
  href?: string | null;
  annotations: {
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    underline?: boolean;
    code?: boolean;
    color?: string;
  };
  text?: { content: string; link?: { url: string } | null };
}

/** Shape we read from page.properties[key] — Notion has ~25 property
 * types; we only need a strict subset for routing (title, date,
 * status, select, multi_select, people, relation, url, email,
 * phone_number, number, checkbox, created_time, last_edited_time). */
export interface NotionProperty {
  id: string;
  type: string;
  // Below: the most common payload shapes; unknown types are tolerated.
  title?: NotionRichText[];
  rich_text?: NotionRichText[];
  number?: number | null;
  select?: { id: string; name: string; color?: string } | null;
  multi_select?: { id: string; name: string; color?: string }[];
  status?: { id: string; name: string; color?: string } | null;
  date?: {
    start: string;
    end?: string | null;
    time_zone?: string | null;
  } | null;
  people?: { id: string; name?: string; person?: { email?: string } }[];
  url?: string | null;
  email?: string | null;
  phone_number?: string | null;
  checkbox?: boolean;
  created_time?: string;
  last_edited_time?: string;
  formula?: { type: string; string?: string | null; number?: number | null; date?: NotionProperty["date"]; boolean?: boolean | null };
  relation?: { id: string }[];
}

export interface NotionPropertyDefinition {
  id: string;
  name: string;
  type: string;
}

/* ─────────────────────────── blocks ────────────────────────────── */

export interface NotionBlock {
  id: string;
  object: "block";
  parent: NotionParent;
  type: string;
  has_children: boolean;
  archived: boolean;
  created_time: string;
  last_edited_time: string;
  // Type-specific payload — we narrow on `type` at the call site.
  paragraph?: { rich_text: NotionRichText[]; color?: string };
  heading_1?: { rich_text: NotionRichText[]; color?: string; is_toggleable?: boolean };
  heading_2?: { rich_text: NotionRichText[]; color?: string; is_toggleable?: boolean };
  heading_3?: { rich_text: NotionRichText[]; color?: string; is_toggleable?: boolean };
  bulleted_list_item?: { rich_text: NotionRichText[]; color?: string };
  numbered_list_item?: { rich_text: NotionRichText[]; color?: string };
  to_do?: { rich_text: NotionRichText[]; checked: boolean; color?: string };
  toggle?: { rich_text: NotionRichText[]; color?: string };
  quote?: { rich_text: NotionRichText[]; color?: string };
  callout?: { rich_text: NotionRichText[]; icon?: NotionIcon; color?: string };
  code?: { rich_text: NotionRichText[]; language?: string; caption?: NotionRichText[] };
  image?: { type: "external" | "file"; external?: { url: string }; file?: { url: string }; caption?: NotionRichText[] };
  video?: { type: "external" | "file"; external?: { url: string }; file?: { url: string } };
  bookmark?: { url: string; caption?: NotionRichText[] };
  divider?: Record<string, never>;
  equation?: { expression: string };
  embed?: { url: string };
  table_of_contents?: { color?: string };
  child_page?: { title: string };
  child_database?: { title: string };
  link_to_page?: { type: "page_id" | "database_id"; page_id?: string; database_id?: string };
  // Catch-all for unknown shapes — kept as unknown so we don't pretend
  // to know the schema.
  [key: string]: unknown;
}

/* ─────────────────────────── sync output ───────────────────────── */

export interface NotionSyncStats {
  scannedPages: number;
  scannedDatabases: number;
  createdProjects: number;
  upsertedDocuments: number;
  upsertedEvents: number;
  upsertedDataTables: number;
  archivedDocuments: number;
  durationMs: number;
}
