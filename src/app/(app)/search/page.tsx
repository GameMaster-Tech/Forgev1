"use client";

/**
 * Search — the dedicated full-workspace search surface.
 *
 * Complements ⌘K: searches every document's title *and* body across all
 * projects, shows matched snippets with the query highlighted, and opens
 * the document on click. Reads through the client Firestore SDK so it
 * works without any Admin-credentialed server route.
 *
 * Obsidian-Ink styling — sharp edges, violet accent, semantic tokens,
 * the standard motion.header.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Search as SearchIcon, FileText, Loader2, ArrowRight } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useProjectsStore } from "@/store/projects";
import { getUserDocuments, type FirestoreDocument } from "@/lib/firebase/firestore";

const ease = [0.22, 0.61, 0.36, 1] as const;
const MAX_DOCS = 300;

function toPlainText(content: unknown): string {
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
    .trim();
}

/** Build a snippet centred on the first match of `q` within `text`. */
function snippetAround(text: string, q: string, radius = 90): { before: string; match: string; after: string } | null {
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return null;
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + q.length + radius);
  return {
    before: (start > 0 ? "…" : "") + text.slice(start, idx),
    match: text.slice(idx, idx + q.length),
    after: text.slice(idx + q.length, end) + (end < text.length ? "…" : ""),
  };
}

interface Indexed {
  doc: FirestoreDocument;
  plain: string;
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-full bg-background flex items-center justify-center">
          <Loader2 size={18} className="text-violet animate-spin" />
        </div>
      }
    >
      <SearchInner />
    </Suspense>
  );
}

function SearchInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useAuth();
  const projects = useProjectsStore((s) => s.projects);
  const fetchProjects = useProjectsStore((s) => s.fetchProjects);

  const [query, setQuery] = useState(params.get("q") ?? "");
  const [index, setIndex] = useState<Indexed[]>([]);
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const uid = user?.uid;

  useEffect(() => {
    if (uid) fetchProjects(uid);
  }, [uid, fetchProjects]);

  useEffect(() => {
    let cancelled = false;
    if (!uid) {
      // Defer so we never setState synchronously inside the effect body.
      const t = setTimeout(() => {
        if (!cancelled) setLoading(false);
      });
      return () => {
        cancelled = true;
        clearTimeout(t);
      };
    }
    getUserDocuments(uid, MAX_DOCS)
      .then((docs) => {
        if (cancelled) return;
        setIndex(docs.map((doc) => ({ doc, plain: toPlainText(doc.content) })));
      })
      .catch(() => {
        if (!cancelled) setIndex([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const projectNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) m.set(p.id, p.name);
    return m;
  }, [projects]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return index
      .map(({ doc, plain }) => {
        const title = (doc.title || "Untitled document").toLowerCase();
        const titleHit = title.includes(q);
        const bodyHit = plain.toLowerCase().includes(q);
        if (!titleHit && !bodyHit) return null;
        return {
          doc,
          score: (titleHit ? 100 : 0) + (bodyHit ? 40 : 0),
          snippet: bodyHit ? snippetAround(plain, q) : null,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 100);
  }, [query, index]);

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (results.length > 0) {
        const d = results[0].doc;
        router.push(`/project/${d.projectId}/doc/${d.id}`);
      }
    },
    [results, router],
  );

  return (
    <div className="min-h-full bg-background">
      <motion.header
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease }}
        className="border-b border-border px-6 sm:px-10 pt-10 pb-6"
      >
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-2 flex items-center gap-2">
          <SearchIcon size={11} strokeWidth={1.75} className="text-muted" />
          Search
        </p>
        <h1 className="font-display font-extrabold text-3xl sm:text-4xl text-foreground tracking-[-0.025em] leading-[1.05] mb-5">
          Find anything.
        </h1>
        <form onSubmit={onSubmit} className="flex items-center gap-3 max-w-2xl border border-border focus-within:border-violet bg-surface px-4 py-3 transition-colors">
          <SearchIcon size={16} className="text-muted shrink-0" strokeWidth={1.75} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search titles and content across every project…"
            className="flex-1 bg-transparent outline-none text-[15px] text-foreground placeholder:text-muted"
          />
          {loading ? <Loader2 size={14} className="animate-spin text-muted" /> : null}
        </form>
      </motion.header>

      <div className="px-6 sm:px-10 pt-8 pb-16 max-w-3xl">
        {!query.trim() ? (
          <p className="text-[13px] text-muted">
            Type to search across {index.length} document{index.length === 1 ? "" : "s"}. Press Enter to open the top match.
          </p>
        ) : results.length === 0 ? (
          <div className="border border-dashed border-border bg-surface/40 p-10 text-center">
            <h3 className="font-display font-bold text-foreground text-[18px] tracking-[-0.018em] mb-2">
              No matches.
            </h3>
            <p className="text-[12.5px] text-muted">
              Nothing matched &ldquo;{query}&rdquo; in titles or content.
            </p>
          </div>
        ) : (
          <>
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
              {results.length} result{results.length === 1 ? "" : "s"}
            </p>
            <ul className="divide-y divide-border border border-border bg-surface">
              {results.map(({ doc, snippet }) => (
                <li key={doc.id}>
                  <Link
                    href={`/project/${doc.projectId}/doc/${doc.id}`}
                    className="group flex items-start gap-4 px-5 py-4 hover:bg-violet/[0.05] transition-colors"
                  >
                    <div className="w-8 h-8 border border-border bg-background flex items-center justify-center shrink-0 mt-0.5 group-hover:border-violet/40 transition-colors">
                      <FileText size={13} strokeWidth={1.75} className="text-muted group-hover:text-violet transition-colors" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-display font-bold text-[15px] text-foreground truncate group-hover:text-violet transition-colors tracking-[-0.01em]">
                          {doc.title || "Untitled document"}
                        </h3>
                        <span className="text-[10px] uppercase tracking-[0.12em] text-muted shrink-0">
                          {projectNameById.get(doc.projectId) ?? "Project"}
                        </span>
                      </div>
                      {snippet ? (
                        <p className="text-[12.5px] text-muted mt-1 leading-relaxed line-clamp-2">
                          {snippet.before}
                          <mark className="bg-violet/20 text-foreground px-0.5">{snippet.match}</mark>
                          {snippet.after}
                        </p>
                      ) : null}
                    </div>
                    <ArrowRight size={14} className="text-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1" />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
