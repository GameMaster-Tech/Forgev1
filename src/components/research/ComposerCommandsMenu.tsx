"use client";

/**
 * ComposerCommandsMenu — the popover for @ pull / / do / # find.
 *
 * Rendered inside the chat composer when `useComposerCommands`
 * reports an active trigger. The mode is decided by `state.trigger`:
 *
 *   @  → list of workspace docs (via useWorkspaceRefs). Picking one
 *        inserts `@<Title>` into the textarea AND adds the doc id
 *        to the consumer's refs array so the chat route can resolve
 *        it server-side.
 *
 *   /  → list of imperative actions. Picking one fires the consumer's
 *        callback IMMEDIATELY and the menu closes. We delete the
 *        trigger fragment from the textarea so the action doesn't
 *        leave `/new` text behind.
 *
 *   #  → not a list — just a hint card showing what # does. The
 *        user keeps typing; on send, the server detects the `#`
 *        prefix and routes through the web-search-first pathway.
 *        (No picker because the query IS the search string.)
 *
 * Keyboard model — the consumer intercepts ArrowUp / ArrowDown /
 * Enter / Tab / Esc and routes them here while the menu is open.
 */

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AtSign,
  Calendar as CalendarIcon,
  CornerDownLeft,
  FileText,
  Globe,
  Hash,
  Loader2,
  RotateCcw,
  Slash,
  Sparkles,
  X,
} from "lucide-react";
import type { ComposerCommandState } from "@/hooks/useComposerCommands";
import { useWorkspaceRefs, type WorkspaceRef } from "@/hooks/useWorkspaceRefs";

const EASE = [0.22, 0.61, 0.36, 1] as const;

/* ─────────────────────────── actions ─────────────────────────── */

export type ComposerAction =
  | "new_chat"
  | "clear_draft"
  | "toggle_past_you"
  | "help";

interface ActionDescriptor {
  kind: ComposerAction;
  label: string;
  hint: string;
  icon: typeof Sparkles;
  keywords: string[];
}

const ACTIONS: ActionDescriptor[] = [
  {
    kind: "new_chat",
    label: "New chat",
    hint: "Start a fresh conversation",
    icon: Sparkles,
    keywords: ["new", "chat", "reset", "start"],
  },
  {
    kind: "clear_draft",
    label: "Clear draft",
    hint: "Empty the message you're typing",
    icon: X,
    keywords: ["clear", "draft", "empty", "delete"],
  },
  {
    kind: "toggle_past_you",
    label: "Talk to past-you",
    hint: "Open Past-You temporal chat",
    icon: RotateCcw,
    keywords: ["past", "you", "time", "history", "memory"],
  },
  {
    kind: "help",
    label: "How commands work",
    hint: "@ pull, / do, # find",
    icon: Slash,
    keywords: ["help", "?", "commands"],
  },
];

function filterActions(query: string): ActionDescriptor[] {
  const q = query.trim().toLowerCase();
  if (!q) return ACTIONS;
  return ACTIONS.filter(
    (a) =>
      a.label.toLowerCase().includes(q) ||
      a.keywords.some((k) => k.includes(q)),
  );
}

/* ─────────────────────────── component ─────────────────────────── */

export interface ComposerCommandsMenuProps {
  state: ComposerCommandState;
  projectId: string | null;
  /** Called when the user picks a doc — replaceWith should be the
   * token text to drop into the textarea (e.g. `@Doc Title `). */
  onPickRef: (ref: WorkspaceRef) => void;
  /** Called when the user picks an action. */
  onAction: (action: ComposerAction) => void;
  /** Close without doing anything (Esc). */
  onClose: () => void;
  /** Selected index (0-based). Consumer owns it so keyboard
   * navigation can be driven from the textarea's keydown. */
  activeIndex: number;
  setActiveIndex: (i: number) => void;
}

export function ComposerCommandsMenu({
  state,
  projectId,
  onPickRef,
  onAction,
  onClose,
  activeIndex,
  setActiveIndex,
}: ComposerCommandsMenuProps) {
  const refsApi = useWorkspaceRefs(projectId);

  const items = useMemo(() => {
    if (state.trigger === "@") {
      const list = refsApi.search(state.query);
      return list.map((r) => ({
        kind: "ref" as const,
        ref: r,
        label: r.title,
        icon: FileText,
        hint: "Doc",
      }));
    }
    if (state.trigger === "/") {
      const list = filterActions(state.query);
      return list.map((a) => ({
        kind: "action" as const,
        action: a.kind,
        label: a.label,
        icon: a.icon,
        hint: a.hint,
      }));
    }
    return [];
  }, [state.trigger, state.query, refsApi]);

  // Reset activeIndex when items change so we never point past the
  // end of a freshly-filtered list.
  useEffect(() => {
    if (activeIndex > items.length - 1) setActiveIndex(0);
  }, [items.length, activeIndex, setActiveIndex]);

  const pick = (i: number) => {
    const item = items[i];
    if (!item) return;
    if (item.kind === "ref") onPickRef(item.ref);
    else if (item.kind === "action") onAction(item.action);
  };

  // The composer's textarea keydown handler can't dispatch into this
  // component directly, so it fires a window CustomEvent on Enter
  // and we pick the currently-highlighted row. The textarea retains
  // ownership of all other key bindings.
  useEffect(() => {
    const onEnter = (e: Event) => {
      const detail = (e as CustomEvent<{ index: number }>).detail;
      pick(typeof detail?.index === "number" ? detail.index : activeIndex);
    };
    window.addEventListener("forge:composer:enter", onEnter);
    return () => window.removeEventListener("forge:composer:enter", onEnter);
    // pick depends on items; items rebuilds when query changes — we
    // intentionally rebind on every change.
  }, [items, activeIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AnimatePresence>
      <motion.div
        key="composer-menu"
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.14, ease: EASE }}
        role="listbox"
        aria-label={
          state.trigger === "@"
            ? "Workspace references"
            : state.trigger === "/"
              ? "Commands"
              : "Web search hint"
        }
        className="absolute bottom-full left-0 right-0 mb-2 z-50"
      >
        <div className="mx-auto max-w-[680px] bg-background border border-border shadow-[0_16px_40px_-16px_rgba(0,0,0,0.25)]">
          {/* Mode header — small chip telling the user what they're in */}
          <ModeHeader trigger={state.trigger} query={state.query} onClose={onClose} />

          {/* Body */}
          {state.trigger === "#" ? (
            <FindHint query={state.query} />
          ) : items.length === 0 ? (
            <EmptyState trigger={state.trigger} loading={refsApi.loading} />
          ) : (
            <ul className="py-1">
              {items.map((it, i) => (
                <li key={`${it.kind}-${i}`}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      // mousedown (not click) so the textarea doesn't
                      // lose focus before we replace its value.
                      e.preventDefault();
                      pick(i);
                    }}
                    onMouseEnter={() => setActiveIndex(i)}
                    aria-selected={activeIndex === i}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                      activeIndex === i
                        ? "bg-violet/[0.08]"
                        : "hover:bg-foreground/[0.04]"
                    }`}
                  >
                    <it.icon
                      size={13}
                      strokeWidth={2}
                      className={
                        activeIndex === i ? "text-violet" : "text-muted"
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-foreground truncate">
                        {it.label}
                      </div>
                      <div className="text-[10.5px] text-muted truncate">
                        {it.hint}
                      </div>
                    </div>
                    {activeIndex === i ? (
                      <CornerDownLeft
                        size={10}
                        strokeWidth={2}
                        className="text-muted shrink-0"
                      />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Footer — keyboard help */}
          <div className="flex items-center justify-between gap-3 px-3 py-1.5 border-t border-border bg-foreground/[0.02] text-[10px] text-muted">
            <span>
              <kbd className="font-mono text-foreground">↑↓</kbd> navigate
              · <kbd className="font-mono text-foreground">↵</kbd> select
              · <kbd className="font-mono text-foreground">esc</kbd> close
            </span>
            <span className="tabular-nums">
              {state.trigger === "@"
                ? "Pull"
                : state.trigger === "/"
                  ? "Do"
                  : "Find"}
            </span>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

/* ─────────────────────────── pieces ─────────────────────────── */

function ModeHeader({
  trigger,
  query,
  onClose,
}: {
  trigger: "@" | "/" | "#";
  query: string;
  onClose: () => void;
}) {
  const Icon = trigger === "@" ? AtSign : trigger === "/" ? Slash : Hash;
  const label =
    trigger === "@"
      ? "Reference a doc"
      : trigger === "/"
        ? "Run a command"
        : "Search the web";
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-foreground/[0.02]">
      <Icon size={12} strokeWidth={2} className="text-violet" />
      <span className="text-[11px] uppercase tracking-[0.14em] text-violet font-semibold">
        {label}
      </span>
      {query ? (
        <span className="text-[11px] text-muted truncate">
          · &ldquo;{query}&rdquo;
        </span>
      ) : null}
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
          onClose();
        }}
        aria-label="Close menu"
        className="ml-auto p-1 text-muted hover:text-foreground transition-colors"
      >
        <X size={11} strokeWidth={2} />
      </button>
    </div>
  );
}

function EmptyState({
  trigger,
  loading,
}: {
  trigger: "@" | "/" | "#";
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-4 text-[12px] text-muted">
        <Loader2 size={12} className="animate-spin text-violet" />
        Loading workspace…
      </div>
    );
  }
  return (
    <div className="px-3 py-4 text-[12px] text-muted leading-relaxed">
      {trigger === "@"
        ? "No matching docs in this project."
        : trigger === "/"
          ? "No matching commands."
          : "Type something to search."}
    </div>
  );
}

function FindHint({ query }: { query: string }) {
  return (
    <div className="px-3 py-3 text-[12.5px] leading-relaxed">
      <div className="flex items-start gap-2.5">
        <Globe
          size={14}
          strokeWidth={2}
          className="text-violet shrink-0 mt-0.5"
        />
        <div className="min-w-0">
          <div className="text-foreground">
            {query ? (
              <>
                Forge will search the web for{" "}
                <span className="font-semibold">&ldquo;{query}&rdquo;</span>{" "}
                before answering.
              </>
            ) : (
              <>Keep typing to search the web before answering.</>
            )}
          </div>
          <div className="text-muted text-[11px] mt-0.5 flex items-center gap-1.5">
            <CalendarIcon size={9} strokeWidth={2} />
            Press <kbd className="font-mono text-foreground">↵</kbd> to send
            as a search-first message.
          </div>
        </div>
      </div>
    </div>
  );
}
