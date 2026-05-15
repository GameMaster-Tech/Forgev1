"use client";

import { useState } from "react";
import {
  Send,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  ExternalLink,
  Quote,
  X,
  Search,
  BookOpen,
  Sparkles,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useProjectGraphStore } from "@/store/projectGraph";

const ease = [0.22, 0.61, 0.36, 1] as const;

interface Source {
  title: string;
  url: string;
  text?: string;
  highlights?: string[];
  publishedDate?: string;
  author?: string;
  verified?: boolean;
  doi?: string;
  journal?: string;
  year?: number;
  verifying?: boolean;
}

interface ResearchSidePanelProps {
  open: boolean;
  onClose: () => void;
  onInsertCitation: (citation: { title: string; doi?: string; url: string; text: string }) => void;
  projectId?: string;
}

export default function ResearchSidePanel({
  open,
  onClose,
  onInsertCitation,
  projectId,
}: ResearchSidePanelProps) {
  const ingestResearch = useProjectGraphStore((s) => s.ingestResearch);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [searched, setSearched] = useState(false);

  const verifyCitation = async (index: number, source: Source, queryText?: string) => {
    setSources((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], verifying: true };
      return next;
    });

    try {
      const res = await fetch("/api/verify-citation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: source.title, author: source.author || "" }),
      });
      const data = await res.json();

      setSources((prev) => {
        const next = [...prev];
        next[index] = {
          ...next[index],
          verified: data.verified,
          doi: data.doi,
          journal: data.journal,
          year: data.year,
          verifying: false,
        };
        return next;
      });

      // Feed verified metadata into the project graph
      if (projectId && queryText) {
        ingestResearch(projectId, queryText, [
          {
            title: source.title,
            url: source.url,
            author: source.author,
            doi: data.doi,
            journal: data.journal,
            year: data.year,
            verified: data.verified,
            text: source.text,
          },
        ]);
      }
    } catch {
      setSources((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], verified: false, verifying: false };
        return next;
      });
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || loading) return;

    const committedQuery = query.trim();
    setLoading(true);
    setSearched(true);
    setAnswer("");
    setSources([]);

    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: committedQuery, mode: "answer" }),
      });
      const data = await res.json();

      let newSources: Source[] = [];
      if (data.type === "answer") {
        setAnswer(data.answer || "");
        newSources = (data.citations || []).map((c: Source) => ({
          title: c.title,
          url: c.url,
          text: c.text,
          publishedDate: c.publishedDate,
          author: c.author,
        }));
      } else if (data.results) {
        newSources = data.results.map((r: Source) => ({
          title: r.title,
          url: r.url,
          text: r.text,
          highlights: r.highlights,
          publishedDate: r.publishedDate,
          author: r.author,
        }));
      }

      setSources(newSources);

      // Immediate ingest into project graph (pre-verification) — verification
      // will enrich these same nodes via a second ingest pass by DOI match.
      if (projectId && newSources.length > 0) {
        ingestResearch(
          projectId,
          committedQuery,
          newSources.map((s) => ({
            title: s.title,
            url: s.url,
            author: s.author,
            text: s.text,
          })),
        );
      }

      newSources.forEach((source, idx) => verifyCitation(idx, source, committedQuery));
    } catch {
      setSources([]);
      setAnswer("");
    } finally {
      setLoading(false);
    }
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
          <div className="h-full m-3 ml-0 bg-white dark:bg-surface  border border-border/50 shadow-lg flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6  bg-cyan/10 flex items-center justify-center">
                  <Search size={12} className="text-cyan" />
                </div>
                <span className="text-[11px] text-black/60 dark:text-foreground/60 font-semibold tracking-wide uppercase">Research</span>
              </div>
              <button
                onClick={onClose}
                className="text-muted hover:text-black dark:hover:text-foreground hover:bg-surface-light  transition-all duration-200 p-1.5"
              >
                <X size={13} />
              </button>
            </div>

            {/* Search */}
            <form onSubmit={handleSearch} className="px-3 py-3 shrink-0">
              <div className="relative">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Ask a research question..."
                  disabled={loading}
                  className="w-full bg-surface-light dark:bg-background border border-border  text-black dark:text-foreground text-xs px-3.5 py-2.5 pr-9 focus:border-cyan focus:ring-2 focus:ring-cyan/10 focus:bg-white dark:focus:bg-surface focus:outline-none transition-all duration-200 placeholder:text-muted disabled:opacity-40"
                />
                <button
                  type="submit"
                  disabled={loading || !query.trim()}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-cyan transition-colors duration-200 disabled:opacity-15"
                >
                  <Send size={12} />
                </button>
              </div>
            </form>

            {/* Results */}
            <div className="flex-1 overflow-y-auto">
              {!searched && sources.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center px-8">
                  <div className="w-10 h-10  bg-cyan/8 flex items-center justify-center mb-4">
                    <Sparkles size={18} className="text-cyan/30" />
                  </div>
                  <p className="text-[11px] text-muted leading-relaxed">
                    Ask a question. Forge synthesizes an answer from 200M+ sources with verified citations.
                  </p>
                </div>
              )}

              {loading && (
                <div className="flex items-center gap-2.5 px-4 py-8 justify-center">
                  <Loader2 size={13} className="text-cyan animate-spin" />
                  <span className="text-[11px] text-cyan">Synthesizing answer...</span>
                </div>
              )}

              {!loading && searched && !answer && sources.length === 0 && (
                <div className="px-4 py-10 text-center">
                  <p className="text-[11px] text-muted">No answer found. Try refining your query.</p>
                </div>
              )}

              {/* Answer */}
              {answer && (
                <div className="px-3 pb-2">
                  <div className="flex items-center gap-1.5 px-1 mb-2">
                    <Sparkles size={10} className="text-cyan" />
                    <span className="text-[9px] text-cyan font-bold uppercase tracking-wider">Answer</span>
                  </div>
                  <div className="bg-cyan/[0.04] border border-cyan/15  p-3.5">
                    <p className="text-[12px] text-black/80 dark:text-foreground/80 leading-[1.75] whitespace-pre-wrap">
                      {answer}
                    </p>
                  </div>
                </div>
              )}

              {/* Sources */}
              {sources.length > 0 && (
                <div className="p-3 space-y-2">
                  <div className="flex items-center gap-1.5 px-1 mb-2">
                    <BookOpen size={10} className="text-muted" />
                    <span className="text-[9px] text-muted uppercase tracking-widest font-semibold">
                      {sources.length} sources
                    </span>
                    <span className="text-[9px] text-green font-bold ml-auto px-2 py-0.5  bg-green/8">
                      {sources.filter(s => s.verified).length} verified
                    </span>
                  </div>
                  {sources.map((source, idx) => (
                    <SourceCard
                      key={idx}
                      source={source}
                      index={idx}
                      onCite={() => {
                        onInsertCitation({
                          title: source.title,
                          doi: source.doi,
                          url: source.url,
                          text: source.text?.slice(0, 200) || source.title,
                        });
                      }}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-2 border-t border-border shrink-0">
              <p className="text-[8px] text-muted text-center tracking-wide">
                Exa Answer API · Crossref · 150M+ verified publications
              </p>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SourceCard({
  source,
  index,
  onCite,
}: {
  source: Source;
  index: number;
  onCite: () => void;
}) {
  const VerifyIcon = source.verifying
    ? ShieldQuestion
    : source.verified === true
      ? ShieldCheck
      : source.verified === false
        ? ShieldAlert
        : ShieldQuestion;

  const verifyColor = source.verifying
    ? "text-muted"
    : source.verified === true
      ? "text-green"
      : source.verified === false
        ? "text-warm"
        : "text-muted";

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease, delay: 0.04 * index }}
      className="border border-border  bg-white dark:bg-surface p-3 transition-all duration-200 hover:border-violet/50 hover:bg-violet/[0.06] group"
    >
      <div className="flex items-start gap-2">
        <span className="text-[9px] text-cyan font-bold mt-0.5 shrink-0 w-5 h-5  bg-cyan/8 flex items-center justify-center">
          {index + 1}
        </span>
        <div className="flex-1 min-w-0">
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-black/80 dark:text-foreground/80 hover:text-black dark:hover:text-foreground transition-colors duration-200 font-medium leading-snug line-clamp-2 flex items-start gap-1"
          >
            {source.title}
            <ExternalLink size={8} className="shrink-0 mt-0.5 opacity-0 group-hover:opacity-40 transition-opacity" />
          </a>

          {/* Verification */}
          <div className={`flex items-center gap-1 mt-1.5 ${verifyColor}`}>
            <VerifyIcon size={9} className={source.verifying ? "animate-pulse" : ""} />
            <span className="text-[8px] font-medium">
              {source.verifying
                ? "Verifying..."
                : source.verified
                  ? `DOI: ${source.doi}`
                  : source.verified === false
                    ? "Not in Crossref"
                    : "Pending"}
            </span>
          </div>

          {/* Cite button */}
          <button
            onClick={onCite}
            className="flex items-center gap-1 mt-2 text-[9px] text-cyan/60 hover:text-cyan  px-2 py-0.5 hover:bg-cyan/5 transition-all duration-200"
          >
            <Quote size={8} />
            Cite
          </button>
        </div>
      </div>
    </motion.div>
  );
}
