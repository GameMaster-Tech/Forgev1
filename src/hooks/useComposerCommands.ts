"use client";

/**
 * useComposerCommands — state machine for the chat composer's three
 * trigger commands:
 *
 *   @  pull   — workspace reference (doc / project / event / goal)
 *   /  do     — actions (new chat, clear draft, toggle past-you, …)
 *   #  find   — force a web search before answering
 *
 * Mental model (lifted from Cursor + Notion): typing the trigger
 * char in the textarea opens a popover. Subsequent typing AFTER
 * the trigger char becomes the filter query. The popover stays
 * anchored to the trigger position until the user picks, the
 * trigger fragment is deleted, or Esc / a navigation away.
 *
 * What this hook owns:
 *   • current trigger (or null)
 *   • the filter substring (everything from the trigger char up to
 *     the caret)
 *   • the trigger's char-index in the textarea so we can replace it
 *     cleanly on selection
 *
 * What it doesn't own:
 *   • rendering the popover (the component does that)
 *   • executing actions (the consumer wires those)
 *   • token serialisation (the consumer formats `@<title>` tokens
 *     and tracks ref ids alongside)
 *
 * Plays nicely with the existing `Enter to send` handler:
 *   • when the popover is open, the consumer should intercept Enter,
 *     ArrowUp, ArrowDown, Tab, and Escape before they reach the
 *     textarea's own keydown handler.
 */

import { useCallback, useMemo, useState, type RefObject } from "react";

export type ComposerTrigger = "@" | "/" | "#";

const TRIGGER_CHARS: ComposerTrigger[] = ["@", "/", "#"];
/** Any whitespace OR a sentence-ender breaks the filter window. */
const STOP_CHARS = /[\s,;:.?!]/;
/** Max chars of query suffix we'll allow — long substrings are almost
 * always the user typing real prose, not narrowing the picker. */
const MAX_QUERY = 40;

export interface ComposerCommandState {
  trigger: ComposerTrigger;
  /** Position in the textarea value where the trigger char lives. */
  startIndex: number;
  /** Position where the caret is (one past the last query char). */
  caretIndex: number;
  /** Substring between trigger (exclusive) and caret. */
  query: string;
}

export interface UseComposerCommandsApi {
  /** Null when no command is active. */
  state: ComposerCommandState | null;
  /** Call from the textarea's onSelect / onInput. */
  refresh: () => void;
  /** Close the popover without modifying the textarea. */
  close: () => void;
  /**
   * Replace the active trigger+query slice with `replacement` and
   * move the caret to the end of it. Returns the new full value so
   * the consumer can `setDraft(next)`. Closes the popover.
   */
  replaceWith: (replacement: string) => string | null;
  /**
   * Delete the active trigger+query slice without inserting anything
   * (used when the consumer dispatched an action that shouldn't
   * leave text behind, like `/new`). Returns the new full value.
   */
  consume: () => string | null;
}

interface UseComposerCommandsOptions {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** Current draft text. The consumer owns this state. */
  value: string;
  /** Called when replaceWith or consume produces a new draft string. */
  onChange: (next: string) => void;
}

export function useComposerCommands(
  opts: UseComposerCommandsOptions,
): UseComposerCommandsApi {
  const [state, setState] = useState<ComposerCommandState | null>(null);

  /**
   * Scan backwards from the caret to find an active trigger. Stops
   * at whitespace, sentence enders, the start of the textarea, or
   * if the substring grows past MAX_QUERY. That last guard is what
   * stops "hello@example.com" from accidentally opening an @ picker
   * once you cross 40 chars after the @.
   */
  const refresh = useCallback(() => {
    const el = opts.textareaRef.current;
    if (!el) {
      setState(null);
      return;
    }
    const caret = el.selectionStart ?? 0;
    const v = opts.value;
    if (caret === 0) {
      setState(null);
      return;
    }
    // Walk back up to MAX_QUERY+1 chars.
    let i = caret - 1;
    const stopAt = Math.max(0, caret - (MAX_QUERY + 1));
    while (i >= stopAt) {
      const ch = v[i];
      if (STOP_CHARS.test(ch)) {
        setState(null);
        return;
      }
      if (TRIGGER_CHARS.includes(ch as ComposerTrigger)) {
        // Trigger only fires at start-of-string or after whitespace,
        // so "user@email" doesn't open the picker.
        const before = i === 0 ? " " : v[i - 1];
        if (before && !/\s/.test(before)) {
          setState(null);
          return;
        }
        setState({
          trigger: ch as ComposerTrigger,
          startIndex: i,
          caretIndex: caret,
          query: v.slice(i + 1, caret),
        });
        return;
      }
      i -= 1;
    }
    setState(null);
  }, [opts.textareaRef, opts.value]);

  const close = useCallback(() => setState(null), []);

  const replaceWith = useCallback(
    (replacement: string): string | null => {
      if (!state) return null;
      const v = opts.value;
      const before = v.slice(0, state.startIndex);
      const after = v.slice(state.caretIndex);
      const next = `${before}${replacement}${after}`;
      opts.onChange(next);
      // Restore caret to just after the inserted replacement.
      // Defer so React's commit lands first.
      const newCaret = state.startIndex + replacement.length;
      queueMicrotask(() => {
        const el = opts.textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(newCaret, newCaret);
        }
      });
      setState(null);
      return next;
    },
    [state, opts],
  );

  const consume = useCallback((): string | null => {
    if (!state) return null;
    const v = opts.value;
    const before = v.slice(0, state.startIndex);
    const after = v.slice(state.caretIndex);
    const next = `${before}${after}`;
    opts.onChange(next);
    queueMicrotask(() => {
      const el = opts.textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(state.startIndex, state.startIndex);
      }
    });
    setState(null);
    return next;
  }, [state, opts]);

  return useMemo(
    () => ({ state, refresh, close, replaceWith, consume }),
    [state, refresh, close, replaceWith, consume],
  );
}
