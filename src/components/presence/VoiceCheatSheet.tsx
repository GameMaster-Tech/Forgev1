"use client";

/**
 * VoiceCheatSheet — "What can I say to Aria?"
 *
 * Cold-start users don't know what's possible. This overlay lists Aria's
 * capabilities grouped by intent, leads with a route-aware "Right now" section,
 * and makes every concrete example one-click runnable (via the aria:ui run
 * bridge). Examples with [placeholders] are illustrative only (not clickable).
 */

import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { AriaIcon } from "./AriaIcon";

interface Phrase {
  text: string;
  /** Runnable = no placeholder; clicking sends it straight to Aria. */
  run?: boolean;
}
interface Group {
  title: string;
  phrases: Phrase[];
}

const GROUPS: Group[] = [
  {
    title: "Navigate",
    phrases: [
      { text: "Open projects", run: true },
      { text: "Go to my calendar", run: true },
      { text: "Open the last thing I worked on", run: true },
      { text: "Open the [name] project" },
      { text: "Go back", run: true },
    ],
  },
  {
    title: "Create",
    phrases: [
      { text: "Set up my workspace", run: true },
      { text: "Create a project called [name]" },
      { text: "Write a doc about [topic] in this project" },
      { text: "New goal" },
    ],
  },
  {
    title: "Write & edit",
    phrases: [
      { text: "Add a paragraph about [topic] here" },
      { text: "Rename this to [name]" },
      { text: "Summarize this" },
    ],
  },
  {
    title: "Ask & control",
    phrases: [
      { text: "Search for [query]" },
      { text: "Switch to dark mode", run: true },
      { text: "Open the command palette", run: true },
    ],
  },
];

function contextHint(pathname: string | null): Phrase[] {
  const p = pathname ?? "";
  if (/\/doc\//.test(p)) return [{ text: "Add a section about [topic] here" }, { text: "Summarize this" }, { text: "Rename this to [name]" }];
  if (p.startsWith("/calendar")) return [{ text: "New goal" }, { text: "New habit" }, { text: "Open Tempo", run: true }];
  if (p.startsWith("/projects") || p === "/") return [{ text: "Set up my workspace", run: true }, { text: "Create a project called [name]" }];
  if (p.startsWith("/project/")) return [{ text: "Write a doc about [topic] in this project" }, { text: "Open this project's graph", run: true }];
  if (p.startsWith("/research")) return [{ text: "Search for [query]" }, { text: "Ask: [your question]" }];
  return [{ text: "Open projects", run: true }, { text: "Set up my workspace", run: true }];
}

function runPhrase(text: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("aria:ui", { detail: { kind: "run", transcript: text } }));
}

function PhraseChip({ p, onRun }: { p: Phrase; onRun: () => void }) {
  const base =
    "text-[12px] rounded-[0.375rem] px-2.5 py-1.5 border text-left transition-colors";
  if (!p.run) {
    return (
      <span className={`${base} text-muted border-border bg-foreground/[0.02] cursor-default`} title="Fill in the bracketed part out loud">
        “{p.text}”
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onRun}
      title="Run it now"
      className={base}
      style={{
        color: "var(--foreground)",
        background: "color-mix(in srgb, var(--voice) 8%, var(--background))",
        borderColor: "color-mix(in srgb, var(--voice) 28%, var(--border))",
      }}
    >
      <span className="text-[color:var(--voice)]">“</span>
      {p.text}
      <span className="text-[color:var(--voice)]">”</span>
    </button>
  );
}

export function VoiceCheatSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const hints = contextHint(pathname);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} aria-hidden />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="What you can say to Aria"
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
            className="relative w-full max-w-lg max-h-[80vh] overflow-y-auto bg-background border border-border rounded-[0.625rem] shadow-[0_40px_90px_-30px_rgba(0,0,0,0.6)]"
          >
            <div className="sticky top-0 bg-background/95 backdrop-blur border-b border-border px-6 py-4 flex items-center gap-3">
              <span className="text-[color:var(--voice)]">
                <AriaIcon size={20} active />
              </span>
              <div className="flex-1">
                <h2 className="font-display font-bold text-foreground text-[1.05rem] tracking-[-0.01em]">
                  What you can say to Aria
                </h2>
                <p className="text-[11px] text-muted">Click a highlighted phrase to run it · press F2 to speak</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="p-1.5 rounded-[0.375rem] text-muted hover:text-foreground hover:bg-foreground/[0.05] transition-colors"
              >
                <X size={16} strokeWidth={2} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* Route-aware */}
              <div>
                <div className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--voice)] font-semibold mb-2">
                  Right now
                </div>
                <div className="flex flex-wrap gap-2">
                  {hints.map((p) => (
                    <PhraseChip key={p.text} p={p} onRun={() => { runPhrase(p.text); onClose(); }} />
                  ))}
                </div>
              </div>

              {GROUPS.map((g) => (
                <div key={g.title}>
                  <div className="text-[10px] uppercase tracking-[0.16em] text-muted/70 font-semibold mb-2">
                    {g.title}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {g.phrases.map((p) => (
                      <PhraseChip key={p.text} p={p} onRun={() => { runPhrase(p.text); onClose(); }} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
