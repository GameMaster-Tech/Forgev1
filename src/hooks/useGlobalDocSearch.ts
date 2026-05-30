"use client";

/**
 * useGlobalDocSearch — registers the signed-in user's documents as a
 * Cmd-K command source so the palette can jump to any doc across every
 * project, matched by title *and* body content.
 *
 * Why a dedicated source (rather than the per-project retrieval lib):
 * the command palette is a flat, in-memory fuzzy index over registered
 * `CommandItem`s (see useCommandPalette). The per-project BM25 engine
 * (`commandPaletteSearch`) needs a projectId and is async; the global
 * palette has no active project on most routes. Registering documents
 * directly — title as the label, a bounded body snippet folded into
 * `keywords` so `fuzzyScore`'s substring pass makes content searchable —
 * gives instant cross-project "find anything" with no extra round-trips.
 *
 * Bounded by construction: at most `MAX_DOCS` docs, each contributing a
 * `SNIPPET_CHARS`-capped content snippet, so the registered payload
 * stays small regardless of workspace size.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useRegisterCommandSource,
  makeCommandId,
  type CommandItem,
} from "@/hooks/useCommandPalette";
import { useAuth } from "@/context/AuthContext";
import { useProjectsStore } from "@/store/projects";
import { getUserDocuments, type FirestoreDocument } from "@/lib/firebase/firestore";

const MAX_DOCS = 120;
// Fold a generous slice of body text into the palette keywords so ⌘K
// matches on document *content*, not just titles.
const SNIPPET_CHARS = 2000;

/** Strip HTML/TipTap markup to a flat string for content matching. */
function toPlainSnippet(content: unknown): string {
  if (typeof content !== "string" || !content) return "";
  return content
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SNIPPET_CHARS);
}

export function useGlobalDocSearch() {
  const router = useRouter();
  const { user } = useAuth();
  const projects = useProjectsStore((s) => s.projects);

  const [docs, setDocs] = useState<FirestoreDocument[]>([]);

  const uid = user?.uid;
  useEffect(() => {
    let cancelled = false;
    if (!uid) {
      // Defer the reset so we never call setState synchronously inside
      // the effect body (cascading-render lint rule).
      const reset = setTimeout(() => {
        if (!cancelled) setDocs([]);
      });
      return () => {
        cancelled = true;
        clearTimeout(reset);
      };
    }
    getUserDocuments(uid, MAX_DOCS)
      .then((list) => {
        if (!cancelled) setDocs(list);
      })
      .catch(() => {
        if (!cancelled) setDocs([]);
      });
    return () => {
      cancelled = true;
    };
    // Re-pull when the user changes or their project set changes (a new
    // doc almost always coincides with a project list mutation, and the
    // palette is cheap to repopulate).
  }, [uid, projects.length]);

  const projectNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) m.set(p.id, p.name);
    return m;
  }, [projects]);

  const items = useMemo<CommandItem[]>(() => {
    return docs
      .filter((d) => typeof d.projectId === "string" && d.projectId)
      .map((d) => {
        const title = d.title?.trim() || "Untitled document";
        const projectName = projectNameById.get(d.projectId) ?? "Project";
        const snippet = toPlainSnippet(d.content);
        return {
          id: makeCommandId("global.documents", d.id),
          kind: "document" as const,
          label: title,
          subtitle: projectName,
          keywords: snippet ? [projectName, snippet] : [projectName],
          href: `/project/${d.projectId}/doc/${d.id}`,
          recencyAt:
            typeof (d as { updatedAt?: { toMillis?: () => number } }).updatedAt?.toMillis === "function"
              ? new Date((d as { updatedAt: { toMillis: () => number } }).updatedAt.toMillis()).toISOString()
              : undefined,
          action: () => router.push(`/project/${d.projectId}/doc/${d.id}`),
        };
      });
  }, [docs, projectNameById, router]);

  useRegisterCommandSource("global.documents", items);
}
