"use client";

/**
 * CommandPalette — global Cmd+K modal for cross-system search.
 *
 * Indexed sources are populated by individual pages via
 * `useRegisterCommandSource`. The palette merges all of them, fuzzy-
 * matches the live query, and routes to the selected item's `href`
 * (with optional scroll anchor) or fires its custom `action`.
 *
 * Keyboard model:
 *   ↑ / ↓     — move highlight
 *   Enter     — select
 *   Esc       — close
 *   Cmd/Ctrl+K — toggle open/close (bound globally via hook)
 *
 * The component is mounted once near the AppShell root so it's
 * available from every authed page.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Calendar,
  FileText,
  Network,
  GitBranch,
  Activity,
  Sparkles,
  ArrowRight,
  Pin,
  PinOff,
  X,
} from "lucide-react";
import {
  useCommandPalette,
  useCommandPaletteShortcut,
  useRankedCommands,
  useRecordSelection,
  useTogglePin,
  usePinned,
  type CommandItem,
  type CommandKind,
} from "@/hooks/useCommandPalette";

const ease = [0.22, 0.61, 0.36, 1] as const;

const KIND_META: Record<CommandKind, { label: string; icon: typeof Calendar; tone: string }> = {
  "assertion":     { label: "Assertion",     icon: GitBranch, tone: "text-violet" },
  "document":      { label: "Document",      icon: FileText,  tone: "text-cyan"   },
  "lattice-task":  { label: "Task",          icon: Network,   tone: "text-warm"   },
  "calendar-event":{ label: "Calendar",      icon: Calendar,  tone: "text-green"  },
  "refactor":      { label: "Refactor",      icon: Activity,  tone: "text-rose"   },
  "action":        { label: "Action",        icon: Sparkles,  tone: "text-foreground" },
};

export function CommandPalette() {
  useCommandPaletteShortcut(); // global Cmd+K

  const { isOpen, close } = useCommandPalette();
  const router = useRouter();
  const pathname = usePathname();
  const pinned = usePinned();
  const recordSelection = useRecordSelection();
  const togglePin = useTogglePin();

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const items = useRankedCommands(query);

  // Reset state every time the palette opens.
  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setActiveIndex(0);
    const handle = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(handle);
  }, [isOpen]);

  // Clamp active index when the list shrinks.
  useEffect(() => {
    if (activeIndex >= items.length) setActiveIndex(Math.max(0, items.length - 1));
  }, [items.length, activeIndex]);

  // Close on pathname change so navigation auto-dismisses.
  useEffect(() => {
    if (isOpen) close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Keep the active row scrolled into view.
  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-row-index="${activeIndex}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const handleSelect = (item: CommandItem) => {
    recordSelection(item.id);
    close();
    if (item.action) {
      item.action();
      return;
    }
    if (!item.href) return;
    const href = item.anchor ? `${item.href}#${encodeURIComponent(item.anchor)}` : item.href;
    router.push(href);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = items[activeIndex];
      if (it) handleSelect(it);
    } else if (e.key === "Tab") {
      // Avoid focus leaving the palette while open.
      e.preventDefault();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease }}
          className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-foreground/40 backdrop-blur-sm"
          onClick={close}
          aria-modal="true"
          role="dialog"
          aria-label="Command palette"
        >
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.99 }}
            transition={{ duration: 0.22, ease }}
            className="w-full max-w-2xl mx-4 bg-background border border-border shadow-[0_30px_80px_-30px_rgba(0,0,0,0.5)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <Search size={14} className="text-muted shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={handleKeyDown}
                placeholder="Search assertions, docs, tasks, events…"
                className="flex-1 bg-transparent outline-none text-[14px] placeholder:text-muted"
                aria-label="Search Forge"
                spellCheck={false}
              />
              <kbd className="text-[10px] uppercase tracking-[0.14em] text-muted font-semibold border border-border px-1.5 py-0.5">Esc</kbd>
              <button
                onClick={close}
                className="text-muted hover:text-foreground"
                aria-label="Close palette"
              >
                <X size={14} />
              </button>
            </div>

            <div
              ref={listRef}
              className="max-h-[58vh] overflow-y-auto"
              role="listbox"
            >
              {items.length === 0 ? (
                <EmptyState query={query} />
              ) : (
                <ResultList
                  items={items}
                  activeIndex={activeIndex}
                  onHover={setActiveIndex}
                  onSelect={handleSelect}
                  onTogglePin={togglePin}
                  pinned={pinned}
                />
              )}
            </div>

            <div className="border-t border-border px-4 py-2.5 text-[10px] uppercase tracking-[0.14em] text-muted font-medium flex items-center justify-between flex-wrap gap-2">
              <span>
                {items.length === 0 ? "No matches" : `${items.length} match${items.length === 1 ? "" : "es"}`}
              </span>
              <span className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <kbd className="border border-border px-1.5 py-0.5">↑ ↓</kbd> nav
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="border border-border px-1.5 py-0.5">↵</kbd> select
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="border border-border px-1.5 py-0.5">⌘K</kbd> close
                </span>
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className="py-12 text-center">
      <p className="text-[13px] text-muted">
        {query.trim().length === 0
          ? "Start typing to search across the workspace."
          : <>No matches for <span className="text-foreground font-medium">&quot;{query}&quot;</span>.</>}
      </p>
    </div>
  );
}

function ResultList({
  items,
  activeIndex,
  onHover,
  onSelect,
  onTogglePin,
  pinned,
}: {
  items: CommandItem[];
  activeIndex: number;
  onHover: (i: number) => void;
  onSelect: (it: CommandItem) => void;
  onTogglePin: (id: string) => void;
  pinned: string[];
}) {
  // Group by kind for the section labels.
  const grouped = useMemo(() => {
    const out: { kind: CommandKind; entries: { item: CommandItem; absIndex: number }[] }[] = [];
    const map = new Map<CommandKind, { item: CommandItem; absIndex: number }[]>();
    items.forEach((item, i) => {
      const arr = map.get(item.kind) ?? [];
      arr.push({ item, absIndex: i });
      map.set(item.kind, arr);
    });
    for (const [kind, entries] of map) out.push({ kind, entries });
    return out;
  }, [items]);

  return (
    <ul className="py-2">
      {grouped.map(({ kind, entries }) => {
        const meta = KIND_META[kind];
        const Icon = meta.icon;
        return (
          <li key={kind} className="py-1">
            <div className="px-4 py-1.5 text-[10px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5">
              <Icon size={10} className={meta.tone} />
              {meta.label}
              <span className="text-muted/70 tabular-nums">· {entries.length}</span>
            </div>
            <ul role="presentation">
              {entries.map(({ item, absIndex }) => {
                const active = absIndex === activeIndex;
                const isPinned = pinned.includes(item.id);
                return (
                  <li key={item.id}>
                    <button
                      data-row-index={absIndex}
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => onHover(absIndex)}
                      onClick={() => onSelect(item)}
                      className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors ${
                        active ? "bg-violet/[0.08]" : "hover:bg-violet/[0.04]"
                      }`}
                    >
                      <Icon size={12} className={`${meta.tone} shrink-0`} strokeWidth={1.75} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] text-foreground font-medium truncate">{item.label}</div>
                        {item.subtitle && (
                          <div className="text-[11px] text-muted truncate">{item.subtitle}</div>
                        )}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onTogglePin(item.id);
                        }}
                        className={`shrink-0 w-7 h-7 flex items-center justify-center transition-colors ${
                          isPinned ? "text-violet" : "text-muted/60 hover:text-foreground"
                        }`}
                        aria-label={isPinned ? "Unpin" : "Pin"}
                        title={isPinned ? "Unpin" : "Pin"}
                      >
                        {isPinned ? <Pin size={11} /> : <PinOff size={11} />}
                      </button>
                      {active && <ArrowRight size={11} className="text-violet shrink-0" strokeWidth={2.25} />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}
