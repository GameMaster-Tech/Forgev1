"use client";

import { useState, useCallback, useMemo } from "react";
import {
  X,
  ShieldCheck,
  ShieldAlert,
  Loader2,
  Sparkles,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Quote,
  Search,
  CheckCircle2,
  Play,
  Flag,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const ease = [0.22, 0.61, 0.36, 1] as const;

type ClaimSeverity = "high" | "medium" | "low";
type ClaimKind =
  | "statistic"
  | "historical"
  | "scientific"
  | "attribution"
  | "causal"
  | "definition"
  | "opinion";

interface ExtractedClaim {
  id: string;
  text: string;
  kind: ClaimKind;
  severity: ClaimSeverity;
  needsCitation: boolean;
  reasoning: string;
  suggestedQuery: string;
}

interface ClaimSource {
  title: string;
  url: string;
  publishedDate?: string;
  author?: string;
  text?: string;
}

interface ClaimState {
  claim: ExtractedClaim;
  expanded: boolean;
  dismissed: boolean;
  cited: boolean;
  sources: ClaimSource[];
  searchLoading: boolean;
  searchError: string | null;
}

interface ClaimCheckPanelProps {
  open: boolean;
  onClose: () => void;
  getEditorText: () => string;
  onJumpToClaim: (text: string) => void;
  onInsertCitation: (citation: {
    title: string;
    url: string;
    text: string;
    doi?: string;
  }) => void;
}

const severityStyles: Record<
  ClaimSeverity,
  { dot: string; chip: string; border: string; label: string }
> = {
  high: {
    dot: "bg-rose",
    chip: "bg-rose/10 text-rose border-rose/25",
    border: "border-l-rose",
    label: "High",
  },
  medium: {
    dot: "bg-warm",
    chip: "bg-warm/10 text-warm border-warm/25",
    border: "border-l-warm",
    label: "Medium",
  },
  low: {
    dot: "bg-muted",
    chip: "bg-black/[0.04] dark:bg-white/[0.04] text-muted border-border",
    border: "border-l-border",
    label: "Low",
  },
};

const kindLabels: Record<ClaimKind, string> = {
  statistic: "Statistic",
  historical: "Historical",
  scientific: "Scientific",
  attribution: "Attribution",
  causal: "Causal",
  definition: "Definition",
  opinion: "Opinion",
};

export default function ClaimCheckPanel({
  open,
  onClose,
  getEditorText,
  onJumpToClaim,
  onInsertCitation,
}: ClaimCheckPanelProps) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [states, setStates] = useState<ClaimState[]>([]);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);

  const stats = useMemo(() => {
    const active = states.filter((s) => !s.dismissed);
    return {
      total: active.length,
      high: active.filter((s) => s.claim.severity === "high").length,
      cited: active.filter((s) => s.cited).length,
      unresolved: active.filter(
        (s) => !s.cited && s.claim.needsCitation,
      ).length,
    };
  }, [states]);

  const runCheck = useCallback(async () => {
    const text = getEditorText().trim();
    if (text.length < 40) {
      setError("Write at least a paragraph before running claim check.");
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/check-claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Claim check failed.");
      }
      const claims: ExtractedClaim[] = data.claims || [];
      setStates(
        claims.map((c) => ({
          claim: c,
          expanded: false,
          dismissed: false,
          cited: false,
          sources: [],
          searchLoading: false,
          searchError: null,
        })),
      );
      setLastCheckedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Claim check failed.");
    } finally {
      setChecking(false);
    }
  }, [getEditorText]);

  const toggleExpand = useCallback((id: string) => {
    setStates((prev) =>
      prev.map((s) =>
        s.claim.id === id ? { ...s, expanded: !s.expanded } : s,
      ),
    );
  }, []);

  const dismiss = useCallback((id: string) => {
    setStates((prev) =>
      prev.map((s) => (s.claim.id === id ? { ...s, dismissed: true } : s)),
    );
  }, []);

  const markCited = useCallback((id: string) => {
    setStates((prev) =>
      prev.map((s) => (s.claim.id === id ? { ...s, cited: true } : s)),
    );
  }, []);

  const findSources = useCallback(async (id: string, query: string) => {
    setStates((prev) =>
      prev.map((s) =>
        s.claim.id === id
          ? { ...s, searchLoading: true, searchError: null, expanded: true }
          : s,
      ),
    );
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, mode: "search" }),
      });
      const data = await res.json();
      const sources: ClaimSource[] = (data.results || []).map((r: ClaimSource) => ({
        title: r.title,
        url: r.url,
        publishedDate: r.publishedDate,
        author: r.author,
        text: r.text,
      }));
      setStates((prev) =>
        prev.map((s) =>
          s.claim.id === id
            ? { ...s, searchLoading: false, sources }
            : s,
        ),
      );
    } catch {
      setStates((prev) =>
        prev.map((s) =>
          s.claim.id === id
            ? {
                ...s,
                searchLoading: false,
                searchError: "Search failed. Try again.",
              }
            : s,
        ),
      );
    }
  }, []);

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
            {/* ─── Header ─── */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-violet/10 flex items-center justify-center">
                  <ShieldCheck size={12} className="text-violet" />
                </div>
                <span className="text-[11px] text-black/60 dark:text-foreground/60 font-semibold tracking-wide uppercase">
                  Claim Check
                </span>
              </div>
              <button
                onClick={onClose}
                className="text-muted hover:text-black dark:hover:text-foreground hover:bg-surface-light transition-all duration-200 p-1.5"
              >
                <X size={13} />
              </button>
            </div>

            {/* ─── Run-check control ─── */}
            <div className="px-3 py-3 border-b border-border/60 shrink-0">
              <button
                onClick={runCheck}
                disabled={checking}
                className="w-full group flex items-center justify-center gap-2 bg-violet text-white text-xs font-medium px-3 py-2.5 hover:bg-violet/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {checking ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>Scanning draft…</span>
                  </>
                ) : (
                  <>
                    <Play size={12} />
                    <span>
                      {states.length === 0 ? "Check claims" : "Re-scan draft"}
                    </span>
                  </>
                )}
              </button>
              {lastCheckedAt && !checking && (
                <div className="mt-2 flex items-center gap-3 text-[10px] text-muted">
                  <span className="flex items-center gap-1">
                    <Flag size={9} className="text-rose" />
                    {stats.high} high
                  </span>
                  <span className="flex items-center gap-1">
                    <ShieldAlert size={9} className="text-warm" />
                    {stats.unresolved} unresolved
                  </span>
                  <span className="flex items-center gap-1 ml-auto">
                    <CheckCircle2 size={9} className="text-green" />
                    {stats.cited} cited
                  </span>
                </div>
              )}
            </div>

            {/* ─── Body ─── */}
            <div className="flex-1 overflow-y-auto">
              {error && (
                <div className="mx-3 mt-3 px-3 py-2 bg-rose/[0.06] border border-rose/20 text-[11px] text-rose">
                  {error}
                </div>
              )}

              {!lastCheckedAt && !checking && !error && (
                <div className="flex flex-col items-center justify-center h-full text-center px-8">
                  <div className="w-10 h-10 bg-violet/8 flex items-center justify-center mb-4">
                    <Sparkles size={18} className="text-violet/40" />
                  </div>
                  <p className="text-[11px] text-muted leading-relaxed max-w-[240px]">
                    Scan your draft for factual claims that need a source. Forge flags statistics, attributions, and causal claims.
                  </p>
                </div>
              )}

              {checking && states.length === 0 && (
                <div className="flex flex-col items-center gap-2.5 px-4 py-14">
                  <Loader2 size={14} className="text-violet animate-spin" />
                  <span className="text-[11px] text-violet">
                    Extracting claims…
                  </span>
                  <span className="text-[9px] text-muted uppercase tracking-widest">
                    Typically 3–6 seconds
                  </span>
                </div>
              )}

              {lastCheckedAt && stats.total === 0 && (
                <div className="px-4 py-14 text-center">
                  <CheckCircle2 size={22} className="text-green/50 mx-auto mb-3" />
                  <p className="text-[11px] text-muted leading-relaxed">
                    No flagged claims. Your draft reads as low-risk for this pass.
                  </p>
                </div>
              )}

              {states.length > 0 && (
                <div className="p-3 space-y-2">
                  {states
                    .filter((s) => !s.dismissed)
                    .map((state) => (
                      <ClaimCard
                        key={state.claim.id}
                        state={state}
                        onToggle={() => toggleExpand(state.claim.id)}
                        onJump={() => onJumpToClaim(state.claim.text)}
                        onFindSources={() =>
                          findSources(state.claim.id, state.claim.suggestedQuery)
                        }
                        onDismiss={() => dismiss(state.claim.id)}
                        onCite={(src) => {
                          onInsertCitation({
                            title: src.title,
                            url: src.url,
                            text: src.text || state.claim.suggestedQuery,
                          });
                          markCited(state.claim.id);
                        }}
                      />
                    ))}
                </div>
              )}
            </div>

            {/* ─── Footer ─── */}
            {states.length > 0 && (
              <div className="px-4 py-2.5 border-t border-border/60 flex items-center justify-between shrink-0">
                <span className="text-[9px] text-muted uppercase tracking-widest">
                  {stats.total} active · {states.length - stats.total} dismissed
                </span>
                <button
                  onClick={() => setStates([])}
                  className="text-[10px] text-muted hover:text-rose transition-colors"
                >
                  Clear all
                </button>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ─── Claim card ─── */

function ClaimCard({
  state,
  onToggle,
  onJump,
  onFindSources,
  onDismiss,
  onCite,
}: {
  state: ClaimState;
  onToggle: () => void;
  onJump: () => void;
  onFindSources: () => void;
  onDismiss: () => void;
  onCite: (source: ClaimSource) => void;
}) {
  const { claim, expanded, cited, sources, searchLoading, searchError } = state;
  const sev = severityStyles[claim.severity];

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease }}
      className={`bg-white dark:bg-background/40 border border-border border-l-2 ${sev.border} ${
        cited ? "opacity-60" : ""
      }`}
    >
      {/* Top row: severity, kind, jump */}
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <div className={`w-1.5 h-1.5 ${sev.dot} shrink-0`} />
        <span
          className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 border ${sev.chip}`}
        >
          {sev.label}
        </span>
        <span className="text-[9px] uppercase tracking-widest text-muted font-semibold">
          {kindLabels[claim.kind]}
        </span>
        {cited && (
          <span className="ml-auto flex items-center gap-1 text-[9px] text-green font-bold uppercase tracking-wider">
            <CheckCircle2 size={9} />
            Cited
          </span>
        )}
        {!cited && !claim.needsCitation && (
          <span className="ml-auto text-[9px] text-muted uppercase tracking-wider">
            Optional
          </span>
        )}
      </div>

      {/* Claim text */}
      <button
        onClick={onJump}
        className="w-full text-left px-3 pt-2 pb-1.5 group"
        title="Jump to claim in document"
      >
        <div className="flex items-start gap-1.5">
          <Quote size={10} className="text-muted shrink-0 mt-1" />
          <p className="text-[12px] text-black/85 dark:text-foreground/85 leading-[1.55] group-hover:text-black dark:group-hover:text-foreground transition-colors">
            {claim.text}
          </p>
        </div>
      </button>

      {/* Reasoning */}
      {claim.reasoning && (
        <p className="text-[10px] text-muted leading-relaxed px-3 pb-2 pl-[22px]">
          {claim.reasoning}
        </p>
      )}

      {/* Action row */}
      <div className="flex items-center gap-0.5 px-2 pb-2 pt-0.5 border-t border-border/40 mt-1">
        <button
          onClick={onToggle}
          className="flex items-center gap-1 px-2 py-1.5 text-[10px] text-muted hover:text-black dark:hover:text-foreground hover:bg-surface-light transition-colors"
        >
          {expanded ? (
            <ChevronDown size={10} />
          ) : (
            <ChevronRight size={10} />
          )}
          Query
        </button>
        <button
          onClick={onFindSources}
          disabled={searchLoading}
          className="flex items-center gap-1 px-2 py-1.5 text-[10px] text-violet hover:bg-violet/[0.08] transition-colors disabled:opacity-50"
        >
          {searchLoading ? (
            <Loader2 size={10} className="animate-spin" />
          ) : (
            <Search size={10} />
          )}
          {sources.length > 0 ? "Re-search" : "Find sources"}
        </button>
        <button
          onClick={onDismiss}
          className="ml-auto text-[10px] text-muted hover:text-rose px-2 py-1.5 transition-colors"
        >
          Dismiss
        </button>
      </div>

      {/* Expanded query */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-1 border-t border-border/40 bg-black/[0.02] dark:bg-white/[0.02]">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Sparkles size={9} className="text-violet" />
                <span className="text-[9px] text-muted uppercase tracking-widest font-semibold">
                  Suggested query
                </span>
              </div>
              <p className="text-[11px] text-black/75 dark:text-foreground/75 font-mono leading-relaxed">
                {claim.suggestedQuery}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sources */}
      {searchError && (
        <div className="px-3 pb-3 text-[10px] text-rose">{searchError}</div>
      )}

      {sources.length > 0 && (
        <div className="px-2 pb-2 space-y-1 border-t border-border/40 pt-2">
          <div className="text-[9px] uppercase tracking-widest text-muted font-semibold px-1 pb-1">
            {sources.length} candidate {sources.length === 1 ? "source" : "sources"}
          </div>
          {sources.map((src, i) => (
            <div
              key={i}
              className="group border border-border/60 hover:border-violet/40 bg-white dark:bg-surface transition-colors px-2.5 py-2"
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-black dark:text-foreground font-medium leading-snug line-clamp-2">
                    {src.title}
                  </p>
                  {(src.author || src.publishedDate) && (
                    <p className="text-[9px] text-muted mt-0.5">
                      {src.author}
                      {src.author && src.publishedDate && " · "}
                      {src.publishedDate?.slice(0, 10)}
                    </p>
                  )}
                </div>
                <a
                  href={src.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted hover:text-violet p-1 transition-colors shrink-0"
                  title="Open source"
                >
                  <ExternalLink size={10} />
                </a>
              </div>
              <div className="flex items-center gap-1 mt-1.5">
                <button
                  onClick={() => onCite(src)}
                  className="flex items-center gap-1 text-[10px] text-violet hover:bg-violet/[0.08] px-2 py-1 transition-colors font-medium"
                >
                  <Quote size={9} />
                  Cite this
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
