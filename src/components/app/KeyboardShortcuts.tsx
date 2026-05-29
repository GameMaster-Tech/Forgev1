"use client";

/**
 * KeyboardShortcuts — global cheat-sheet overlay.
 *
 * Press `?` (Shift+/) anywhere outside a text field to open a grouped
 * reference of every keyboard affordance in Forge. Esc or a click on
 * the backdrop closes it. The trigger is suppressed while focus is in
 * an input, textarea, or contenteditable surface so typing a literal
 * "?" into a doc or the composer never pops the sheet.
 *
 * Mounted once near the AppShell root so it is reachable from every
 * authed page.
 */

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Keyboard } from "lucide-react";

const ease = [0.22, 0.61, 0.36, 1] as const;

type Shortcut = { keys: string[]; label: string };
type Group = { title: string; shortcuts: Shortcut[] };

const GROUPS: Group[] = [
  {
    title: "Global",
    shortcuts: [
      { keys: ["⌘", "K"], label: "Open command palette" },
      { keys: ["?"], label: "Show this cheat sheet" },
      { keys: ["Esc"], label: "Close any overlay" },
      { keys: ["G", "H"], label: "Go to home" },
      { keys: ["G", "R"], label: "Go to research" },
      { keys: ["G", "C"], label: "Go to calendar" },
    ],
  },
  {
    title: "Editor",
    shortcuts: [
      { keys: ["/"], label: "Insert block (slash menu)" },
      { keys: ["⌘", "B"], label: "Bold" },
      { keys: ["⌘", "I"], label: "Italic" },
      { keys: ["⌘", "Z"], label: "Undo" },
      { keys: ["⌘", "⇧", "Z"], label: "Redo" },
      { keys: ["⌘", "K"], label: "Add link to selection" },
    ],
  },
  {
    title: "Research chat",
    shortcuts: [
      { keys: ["↵"], label: "Send message" },
      { keys: ["⇧", "↵"], label: "New line" },
      { keys: ["⌘", "↵"], label: "Send from anywhere" },
    ],
  },
];

/** True when the active element accepts free-text input. */
function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable
  );
}

export function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm"
          onClick={() => setOpen(false)}
          aria-modal="true"
          role="dialog"
          aria-label="Keyboard shortcuts"
        >
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.99 }}
            transition={{ duration: 0.22, ease }}
            className="w-full max-w-2xl mx-4 bg-background border border-border shadow-[0_30px_80px_-30px_rgba(0,0,0,0.5)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-border px-5 py-3.5">
              <Keyboard size={14} className="text-violet shrink-0" strokeWidth={1.75} />
              <h2 className="flex-1 text-[11px] uppercase tracking-[0.14em] text-foreground font-semibold">
                Keyboard shortcuts
              </h2>
              <button
                onClick={() => setOpen(false)}
                className="text-muted hover:text-foreground"
                aria-label="Close keyboard shortcuts"
              >
                <X size={14} />
              </button>
            </div>

            <div className="max-h-[64vh] overflow-y-auto p-5 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-6">
              {GROUPS.map((group) => (
                <section key={group.title}>
                  <h3 className="text-[10px] uppercase tracking-[0.18em] text-muted font-semibold mb-2.5">
                    {group.title}
                  </h3>
                  <ul className="space-y-1.5">
                    {group.shortcuts.map((s) => (
                      <li
                        key={s.label}
                        className="flex items-center justify-between gap-4 py-1"
                      >
                        <span className="text-[13px] text-foreground">{s.label}</span>
                        <span className="flex items-center gap-1 shrink-0">
                          {s.keys.map((k, i) => (
                            <kbd
                              key={i}
                              className="min-w-[20px] text-center text-[10px] uppercase tracking-[0.08em] text-muted font-semibold border border-border px-1.5 py-0.5 font-mono"
                            >
                              {k}
                            </kbd>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>

            <div className="border-t border-border px-5 py-2.5 text-[10px] uppercase tracking-[0.14em] text-muted font-medium flex items-center justify-end">
              <span className="flex items-center gap-1">
                <kbd className="border border-border px-1.5 py-0.5 font-mono">Esc</kbd> close
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
