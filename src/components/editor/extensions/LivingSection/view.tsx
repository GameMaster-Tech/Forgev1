"use client";

/**
 * LivingSectionView — React NodeView for the `livingSection` node.
 *
 * The block reads its reactive payload from `node.attrs.data` and writes
 * every change through `updateAttributes`, so ProseMirror persists,
 * collaborates, and undoes for free. The AI owns ONLY the derived body —
 * the rule and the sources are the user's; the value can be frozen — so
 * reactivity never costs control.
 *
 * Visual language: Obsidian Ink. A quiet violet-edged card that reads as
 * "alive" without shouting. Controls stay low-contrast until hover; status
 * is informative, never alarming; drift is a gentle nudge, not an alert.
 */

import { useEffect, useMemo, useState, useCallback } from "react";
import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";
import { motion, AnimatePresence } from "framer-motion";
import { RefreshCw, Lock, LockOpen, Loader2, Sparkles, AlertCircle } from "lucide-react";
import { hashSources, type ReactiveStatus } from "@/lib/reactive/types";
import { normaliseData, type LivingSectionData } from "./extension";

const ease = [0.22, 0.61, 0.36, 1] as const;
const SOURCE_LABEL = "This document";

const STATUS_META: Record<
  ReactiveStatus,
  { label: string; dot: string; text: string }
> = {
  empty:     { label: "New",      dot: "bg-muted/40",  text: "text-muted" },
  computing: { label: "Thinking", dot: "bg-violet",    text: "text-violet" },
  stable:    { label: "Current",  dot: "bg-green",     text: "text-green" },
  drifting:  { label: "Drifted",  dot: "bg-warm",      text: "text-warm" },
  frozen:    { label: "Frozen",   dot: "bg-muted/60",  text: "text-muted" },
  error:     { label: "Failed",   dot: "bg-rose",      text: "text-rose" },
};

/** Minimal sanitiser — the recompute endpoint already constrains tags, this
 *  is defence-in-depth before we render derived HTML read-only. */
function sanitize(html: string): string {
  return html
    .replace(/<\/?(?:script|style|iframe|object|embed)[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, "");
}

export function LivingSectionView({ node, updateAttributes, editor, selected }: NodeViewProps) {
  const data = useMemo<LivingSectionData>(
    () => normaliseData(node.attrs.data),
    [node.attrs.data],
  );

  // Live plaintext of the host document. Lazy-init (no effect setState) and
  // refreshed only inside the editor's update callback — keeps us clear of
  // the cascading-render rule. The same callback PERSISTS drift (stable →
  // drifting) into the node so Calm Review can find stale sections by reading
  // the saved status, without re-deriving text the same way everywhere.
  const [docText, setDocText] = useState(() => editor.getText());
  useEffect(() => {
    const handler = () => {
      const text = editor.getText();
      setDocText(text);
      const current = normaliseData(node.attrs.data);
      if (current.status === "stable" && current.sourceHash) {
        const h = hashSources([{ label: SOURCE_LABEL, text }]);
        if (h !== current.sourceHash) {
          // Transition once; guard prevents an update loop.
          updateAttributes({ data: { ...current, status: "drifting" } });
        }
      }
    };
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
    };
  }, [editor, node.attrs.data, updateAttributes]);

  const currentHash = useMemo(
    () => hashSources([{ label: SOURCE_LABEL, text: docText }]),
    [docText],
  );

  // Drift: a previously-current section whose source has since changed.
  const isStale =
    data.status === "stable" && data.sourceHash !== "" && currentHash !== data.sourceHash;
  const effectiveStatus: ReactiveStatus = isStale ? "drifting" : data.status;
  const meta = STATUS_META[effectiveStatus];

  const patch = useCallback(
    (p: Partial<LivingSectionData>) => updateAttributes({ data: { ...data, ...p } }),
    [data, updateAttributes],
  );

  const recompute = useCallback(async () => {
    const rule = data.rule.trim();
    if (!rule || data.status === "computing") return;
    const text = editor.getText();
    const sources = [{ label: SOURCE_LABEL, text }];
    const hash = hashSources(sources);
    patch({ status: "computing" });
    try {
      const res = await fetch("/api/reactive/recompute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rule, sources }),
      });
      const json = (await res.json()) as { result?: string; error?: string };
      if (json.result) {
        patch({
          value: sanitize(json.result),
          status: "stable",
          sourceHash: hash,
          computedAt: Date.now(),
        });
      } else {
        patch({ status: "error" });
      }
    } catch {
      patch({ status: "error" });
    }
  }, [data.rule, data.status, editor, patch]);

  const toggleFreeze = useCallback(() => {
    patch({ status: data.status === "frozen" ? "stable" : "frozen" });
  }, [data.status, patch]);

  const computing = data.status === "computing";
  const frozen = data.status === "frozen";
  const hasRule = data.rule.trim().length > 0;

  return (
    <NodeViewWrapper
      className="forge-living-section-root my-5"
      contentEditable={false}
    >
      <div
        className={`relative border border-l-2 bg-violet/[0.02] dark:bg-violet/[0.05] transition-colors ${
          selected ? "border-l-violet border-violet/40" : "border-l-violet border-border"
        }`}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 px-3.5 py-2 border-b border-border/60">
          <span className="relative flex items-center justify-center w-3.5 h-3.5 shrink-0">
            {computing ? (
              <Loader2 size={11} className="text-violet animate-spin" />
            ) : (
              <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} aria-hidden />
            )}
          </span>

          <Sparkles size={11} className="text-violet/70 shrink-0" strokeWidth={2} aria-hidden />

          <input
            value={data.rule}
            onChange={(e) => patch({ rule: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void recompute();
              }
            }}
            placeholder="Tell Forge what to keep here…"
            spellCheck={false}
            className="flex-1 min-w-0 bg-transparent text-[12.5px] text-foreground placeholder:text-muted/60 focus:outline-none"
            aria-label="Living section rule"
          />

          <span
            className={`text-[8.5px] uppercase tracking-[0.18em] font-mono font-semibold shrink-0 ${meta.text}`}
          >
            {meta.label}
          </span>

          {/* Quiet controls — low-contrast until hover on the card */}
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={() => void recompute()}
              disabled={!hasRule || computing || frozen}
              aria-label="Refresh now"
              title="Refresh now"
              className="p-1 text-muted hover:text-violet disabled:opacity-30 disabled:hover:text-muted transition-colors"
            >
              <RefreshCw size={12} strokeWidth={2} className={computing ? "animate-spin" : ""} />
            </button>
            <button
              type="button"
              onClick={toggleFreeze}
              aria-label={frozen ? "Unfreeze (resume reactivity)" : "Freeze this value"}
              title={frozen ? "Unfreeze" : "Freeze"}
              className={`p-1 transition-colors ${
                frozen ? "text-violet" : "text-muted hover:text-foreground"
              }`}
            >
              {frozen ? <Lock size={12} strokeWidth={2} /> : <LockOpen size={12} strokeWidth={2} />}
            </button>
          </div>
        </div>

        {/* Drift nudge — calm, one line, only when stale + not frozen */}
        <AnimatePresence>
          {isStale && !frozen && (
            <motion.button
              type="button"
              onClick={() => void recompute()}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease }}
              className="w-full flex items-center gap-2 px-3.5 py-1.5 text-left border-b border-border/60 text-warm hover:bg-warm/[0.05] transition-colors overflow-hidden"
            >
              <RefreshCw size={10} strokeWidth={2} className="shrink-0" />
              <span className="text-[10px] uppercase tracking-[0.12em] font-medium">
                Sources changed — refresh to update
              </span>
            </motion.button>
          )}
        </AnimatePresence>

        {/* Body */}
        <div className="px-3.5 py-3">
          {data.value ? (
            <div
              className="forge-ls-content text-[13.5px] leading-relaxed text-foreground/90"
              // Read-only, sanitised, AI-derived fragment.
              dangerouslySetInnerHTML={{ __html: sanitize(data.value) }}
            />
          ) : data.status === "error" ? (
            <div className="flex items-center gap-2 py-2 text-rose">
              <AlertCircle size={13} />
              <span className="text-[12px]">Couldn&apos;t generate. Check the rule and try again.</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void recompute()}
              disabled={!hasRule || computing}
              className="w-full flex items-center justify-center gap-2 py-4 text-[11px] uppercase tracking-[0.14em] font-semibold text-muted hover:text-violet disabled:opacity-40 disabled:hover:text-muted transition-colors"
            >
              {computing ? (
                <>
                  <Loader2 size={12} className="animate-spin" /> Deriving…
                </>
              ) : (
                <>
                  <Sparkles size={12} /> {hasRule ? "Generate this section" : "Name what to keep here, then generate"}
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  );
}
