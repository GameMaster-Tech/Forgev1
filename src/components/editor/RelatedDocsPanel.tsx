"use client";

/**
 * RelatedDocsPanel — surfaces other workspace artefacts related to the
 * document currently open, using the client-side BM25 retrieval engine
 * (`searchWorkspace`). The probe query is the doc's own title plus a
 * bounded slice of its body, so "related" means lexically/semantically
 * close to what the writer is actually working on.
 *
 * The current document is excluded from its own results by uid. Results
 * span documents, extracted claims, and past research queries — each row
 * jumps to the artefact (docs and claims open their doc; queries open
 * the research thread).
 *
 * Search is debounced and re-runs whenever the panel is open and the
 * probe text changes, so edits to the doc keep the suggestions live
 * without hammering the index on every keystroke.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { FileText, GitBranch, MessageCircleQuestion, X, Loader2 } from "lucide-react";
import { searchWorkspace } from "@/lib/retrieval/search";
import type { SearchResult, WorkspaceItemKind } from "@/lib/retrieval/types";

const ease = [0.22, 0.61, 0.36, 1] as const;
const PROBE_CHARS = 1200;
const DEBOUNCE_MS = 500;

const KINDS: WorkspaceItemKind[] = ["document", "claim", "query"];

const KIND_ICON: Partial<Record<WorkspaceItemKind, typeof FileText>> = {
  document: FileText,
  claim: GitBranch,
  query: MessageCircleQuestion,
};

const KIND_TONE: Partial<Record<WorkspaceItemKind, string>> = {
  document: "text-cyan",
  claim: "text-violet",
  query: "text-warm",
};

interface RelatedDocsPanelProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  docId: string;
  /** Probe text — typically the doc title + plain body. */
  probe: string;
}

export function RelatedDocsPanel({
  open,
  onClose,
  projectId,
  docId,
  probe,
}: RelatedDocsPanelProps) {
  const router = useRouter();
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const selfUid = `document:${docId}`;
  const trimmedProbe = probe.trim().slice(0, PROBE_CHARS);

  useEffect(() => {
    if (!open || !projectId) return;
    let cancelled = false;
    if (trimmedProbe.length === 0) {
      // Defer the reset out of the effect body so we never call setState
      // synchronously during the effect (cascading-render lint rule).
      const reset = setTimeout(() => {
        if (cancelled) return;
        setResults([]);
        setSearched(false);
      });
      return () => {
        cancelled = true;
        clearTimeout(reset);
      };
    }
    const handle = setTimeout(() => {
      if (cancelled) return;
      setLoading(true);
      searchWorkspace(projectId, trimmedProbe, { limit: 12, kinds: KINDS })
        .then((res) => {
          if (cancelled) return;
          setResults(res.filter((r) => r.item.uid !== selfUid).slice(0, 8));
          setSearched(true);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, projectId, trimmedProbe, selfUid]);

  const jump = (result: SearchResult) => {
    const { item } = result;
    if (item.kind === "query") {
      router.push(`/research?c=${encodeURIComponent(item.id)}`);
      return;
    }
    // document + claim both live in a document; claims carry their host
    // doc id in meta.docId when available, else fall back to the item id.
    const targetDoc =
      item.kind === "document"
        ? item.id
        : (item.meta?.docId as string | undefined) ?? item.id;
    router.push(`/project/${projectId}/doc/${targetDoc}`);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 380, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease }}
          className="h-full flex flex-col shrink-0 overflow-hidden"
        >
          <div className="h-full m-3 ml-0 bg-white dark:bg-surface border border-border/50 shadow-lg flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-violet/10 flex items-center justify-center">
                  <GitBranch size={12} className="text-violet" />
                </div>
                <span className="text-[11px] text-black/60 dark:text-foreground/60 font-semibold tracking-wide uppercase">
                  Related
                </span>
              </div>
              <button
                onClick={onClose}
                aria-label="Close related"
                className="text-muted hover:text-black dark:hover:text-foreground hover:bg-surface-light transition-all duration-200 p-1.5"
              >
                <X size={13} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {loading && results.length === 0 ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 size={16} className="text-violet animate-spin" />
                </div>
              ) : results.length === 0 ? (
                <div className="px-5 py-16 text-center">
                  <p className="text-[12px] text-muted leading-relaxed">
                    {searched
                      ? "Nothing else in this project looks related yet. Keep writing — suggestions update as the document grows."
                      : "Start writing to surface related documents, claims, and past research."}
                  </p>
                </div>
              ) : (
                <ul className="py-2">
                  {results.map((r) => {
                    const Icon = KIND_ICON[r.item.kind] ?? FileText;
                    const tone = KIND_TONE[r.item.kind] ?? "text-muted";
                    return (
                      <li key={r.item.uid}>
                        <button
                          type="button"
                          onClick={() => jump(r)}
                          className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-violet/[0.04] transition-colors"
                        >
                          <Icon
                            size={13}
                            className={`${tone} shrink-0 mt-0.5`}
                            strokeWidth={1.75}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-[13px] text-foreground font-medium leading-snug line-clamp-2">
                              {r.item.title || "Untitled"}
                            </div>
                            {r.item.body && (
                              <div className="text-[11px] text-muted mt-1 line-clamp-2 leading-relaxed">
                                {r.item.body}
                              </div>
                            )}
                            <div className="mt-1.5 text-[9px] uppercase tracking-[0.14em] text-muted/70 font-semibold">
                              {r.item.kind}
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
