"use client";

/**
 * useCommandPalette — global Cmd+K / Ctrl+K state + indexed search.
 *
 * The palette indexes a small zustand store of `CommandItem`s
 * registered by individual feature pages. Each page calls
 * `registerCommandSource(sourceId, items)` whenever its data changes;
 * the palette merges every source and fuzzy-matches the user's query
 * against `(label, subtitle, keywords)`.
 *
 * Ranking rules:
 *   1. Recent (last 8 selections) bubble to the top of an empty
 *      query.
 *   2. Pinned items always appear in the top section.
 *   3. Diverse-by-kind padding: when ≥4 items share a kind, the
 *      ranker interleaves with other kinds to surface at least one of
 *      each.
 *   4. Otherwise: fuzzy score (descending), then lexicographic.
 *
 * Headless. The UI lives in CommandPalette.tsx.
 */

import { useCallback, useEffect, useMemo } from "react";
import { create } from "zustand";

export type CommandKind =
  | "assertion"
  | "document"
  | "lattice-task"
  | "calendar-event"
  | "refactor"
  | "action";

export interface CommandItem {
  /** Globally unique id (source-prefixed to avoid collisions). */
  id: string;
  kind: CommandKind;
  /** Primary label shown in the palette row. */
  label: string;
  /** Optional secondary line (key, doc title, timestamp, etc.). */
  subtitle?: string;
  /** Extra keywords to fuzzy-match against (project name, tag, etc.). */
  keywords?: string[];
  /** Optional route the palette navigates to on select. */
  href?: string;
  /** Optional anchor id (page scrolls to `#${anchor}` after route change). */
  anchor?: string;
  /**
   * Optional custom action. Overrides href routing — useful for
   * actions that don't have a routable destination (e.g. "Create
   * project").
   */
  action?: () => void;
  /** Optional ISO timestamp; sorted desc when present. */
  recencyAt?: string;
}

/* ───────────── store ───────────── */

interface CommandStore {
  /** Map from sourceId → list of items. */
  sources: Map<string, CommandItem[]>;
  /** Most-recently-selected ids, capped at 8 (newest first). */
  recents: string[];
  /** Pinned ids (admin-curated). */
  pinned: string[];
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  registerSource: (sourceId: string, items: CommandItem[]) => void;
  unregisterSource: (sourceId: string) => void;
  recordSelection: (id: string) => void;
  togglePin: (id: string) => void;
}

const useCommandStore = create<CommandStore>((set) => ({
  sources: new Map(),
  recents: [],
  pinned: [],
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  registerSource: (sourceId, items) =>
    set((s) => {
      const next = new Map(s.sources);
      next.set(sourceId, items);
      return { sources: next };
    }),
  unregisterSource: (sourceId) =>
    set((s) => {
      const next = new Map(s.sources);
      next.delete(sourceId);
      return { sources: next };
    }),
  recordSelection: (id) =>
    set((s) => {
      const next = [id, ...s.recents.filter((r) => r !== id)].slice(0, 8);
      return { recents: next };
    }),
  togglePin: (id) =>
    set((s) => ({
      pinned: s.pinned.includes(id) ? s.pinned.filter((p) => p !== id) : [...s.pinned, id].slice(0, 16),
    })),
}));

/* ───────────── public API ───────────── */

export function useCommandPalette() {
  const isOpen = useCommandStore((s) => s.isOpen);
  const open = useCommandStore((s) => s.open);
  const close = useCommandStore((s) => s.close);
  const toggle = useCommandStore((s) => s.toggle);
  return { isOpen, open, close, toggle };
}

/**
 * Register a feature source (e.g. "sync.assertions") and keep it in
 * sync with the parent component's data. The hook unregisters on
 * unmount so stale lists don't leak between pages.
 */
export function useRegisterCommandSource(sourceId: string, items: CommandItem[]) {
  const register = useCommandStore((s) => s.registerSource);
  const unregister = useCommandStore((s) => s.unregisterSource);
  useEffect(() => {
    register(sourceId, items);
    return () => unregister(sourceId);
  }, [sourceId, items, register, unregister]);
}

/**
 * Subscribe to the merged + ranked item list for a given query. Pure
 * computation — no side effects.
 */
export function useRankedCommands(query: string): CommandItem[] {
  const sources = useCommandStore((s) => s.sources);
  const recents = useCommandStore((s) => s.recents);
  const pinned = useCommandStore((s) => s.pinned);

  return useMemo(() => {
    const all: CommandItem[] = [];
    for (const list of sources.values()) all.push(...list);
    return rankItems(all, query, { recents, pinned });
  }, [sources, recents, pinned, query]);
}

/** Imperative selector — used by the palette's onSelect handler. */
export function useRecordSelection(): (id: string) => void {
  return useCommandStore((s) => s.recordSelection);
}

/** Imperative selector — used by the pin/unpin row affordance. */
export function useTogglePin(): (id: string) => void {
  return useCommandStore((s) => s.togglePin);
}

export function usePinned(): string[] {
  return useCommandStore((s) => s.pinned);
}

/* ───────────── ranking ───────────── */

interface RankOptions {
  recents: string[];
  pinned: string[];
}

export function rankItems(items: CommandItem[], query: string, opts: RankOptions): CommandItem[] {
  const q = query.trim().toLowerCase();
  const byId = new Map<string, CommandItem>();
  for (const it of items) byId.set(it.id, it);

  // Empty query → recents + pinned + recent-by-recencyAt + diverse fill.
  if (q.length === 0) {
    const ordered: CommandItem[] = [];
    const seen = new Set<string>();
    const push = (it: CommandItem | undefined) => {
      if (!it || seen.has(it.id)) return;
      seen.add(it.id);
      ordered.push(it);
    };
    for (const id of opts.pinned) push(byId.get(id));
    for (const id of opts.recents) push(byId.get(id));
    const byRecency = [...items].sort(byRecencyDesc);
    for (const it of byRecency) push(it);
    return diversify(ordered, 30);
  }

  // Scored search.
  const scored: { it: CommandItem; score: number }[] = [];
  for (const it of items) {
    const score = fuzzyScore(it, q);
    if (score > 0) scored.push({ it, score });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.it.label.localeCompare(b.it.label);
  });

  const result: CommandItem[] = [];
  const seen = new Set<string>();
  for (const id of opts.pinned) {
    const it = byId.get(id);
    if (it && fuzzyScore(it, q) > 0) {
      if (!seen.has(it.id)) {
        result.push(it);
        seen.add(it.id);
      }
    }
  }
  for (const { it } of scored) {
    if (seen.has(it.id)) continue;
    result.push(it);
    seen.add(it.id);
    if (result.length >= 60) break;
  }
  return diversify(result, 30);
}

/**
 * Fuzzy match — sum of:
 *   • exact substring hit (label):  +100
 *   • exact substring hit (subtitle): +60
 *   • exact substring hit (keyword): +40
 *   • per-character "char-in-order" bonus: up to +q.length
 *   • prefix-on-label bonus: +30
 * Returns 0 if no hit at all (caller filters those out).
 */
export function fuzzyScore(item: CommandItem, query: string): number {
  const q = query.toLowerCase();
  if (!q) return 0;
  const label = item.label.toLowerCase();
  const sub = (item.subtitle ?? "").toLowerCase();
  const keys = (item.keywords ?? []).map((s) => s.toLowerCase());
  let score = 0;
  if (label.includes(q)) score += 100;
  if (sub.includes(q)) score += 60;
  for (const k of keys) if (k.includes(q)) score += 40;
  if (label.startsWith(q)) score += 30;
  // Subsequence match against label.
  let qi = 0;
  for (let i = 0; i < label.length && qi < q.length; i++) {
    if (label[i] === q[qi]) qi++;
  }
  if (qi === q.length) score += q.length;
  return score;
}

/**
 * Diversify by kind so the top N rows include at least one of every
 * available kind (when possible). Stable for already-sorted input.
 */
export function diversify(items: CommandItem[], topN: number): CommandItem[] {
  if (items.length <= 1) return items;
  const top = items.slice(0, topN);
  const tail = items.slice(topN);
  const byKind = new Map<CommandKind, CommandItem[]>();
  for (const it of top) {
    const arr = byKind.get(it.kind) ?? [];
    arr.push(it);
    byKind.set(it.kind, arr);
  }
  const kinds = Array.from(byKind.keys());
  if (kinds.length <= 1) return [...top, ...tail];

  // Round-robin interleave: pop the first item of each bucket in turn
  // until all buckets are empty. Preserves the relative order within
  // each kind.
  const buckets = kinds.map((k) => byKind.get(k)!.slice());
  const out: CommandItem[] = [];
  while (buckets.some((b) => b.length > 0)) {
    for (const b of buckets) {
      const next = b.shift();
      if (next) out.push(next);
    }
  }
  return [...out, ...tail];
}

function byRecencyDesc(a: CommandItem, b: CommandItem): number {
  if (a.recencyAt && b.recencyAt) return b.recencyAt.localeCompare(a.recencyAt);
  if (a.recencyAt) return -1;
  if (b.recencyAt) return 1;
  return 0;
}

/* ───────────── keyboard shortcut binding ───────────── */

/**
 * Bind the Cmd+K / Ctrl+K shortcut globally. Mount once near the app
 * root (CommandPalette.tsx does so internally).
 */
export function useCommandPaletteShortcut() {
  const toggle = useCommandStore((s) => s.toggle);
  const close = useCommandStore((s) => s.close);
  const isOpen = useCommandStore((s) => s.isOpen);

  const handler = useCallback(
    (e: KeyboardEvent) => {
      const isMac = typeof navigator !== "undefined" && /Mac|iP(?:hone|ad)/i.test(navigator.platform || navigator.userAgent);
      const trigger = (isMac ? e.metaKey : e.ctrlKey) && (e.key === "k" || e.key === "K");
      if (trigger) {
        e.preventDefault();
        toggle();
        return;
      }
      if (e.key === "Escape" && isOpen) {
        e.preventDefault();
        close();
      }
    },
    [toggle, close, isOpen],
  );

  useEffect(() => {
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handler]);
}

/* ───────────── helpers for source registration ───────────── */

const SAFE_ID_RE = /[^a-z0-9_\-./]/gi;

export function makeCommandId(sourceId: string, raw: string): string {
  return `${sourceId}:${raw.replace(SAFE_ID_RE, "_").slice(0, 80)}`;
}
