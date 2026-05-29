"use client";

/**
 * EditorInputPopover — inline replacement for the native window.prompt()
 * calls ForgeEditor used for links and LaTeX. Caret-anchored, matches the
 * Forge picker scheme (see SlashCommandMenu / ComposerCommandsMenu).
 *
 * It owns its own input value and keyboard handling (Enter submits, Esc
 * cancels). Because the field is a real <input> outside the editor DOM,
 * ProseMirror keeps its document selection, so applying a command on
 * submit lands on the original selection/cursor.
 *
 * The parent remounts this via a `key` derived from kind+initial, so the
 * input value seeds cleanly from `initial` on each open — no state-sync
 * effect needed.
 */

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link as LinkIcon, Sigma, Check, Trash2, X } from "lucide-react";

const EASE = [0.22, 0.61, 0.36, 1] as const;
const POPOVER_WIDTH = 320;

export type EditorInputKind = "link" | "inline-math" | "block-math";

export interface EditorInputPopoverProps {
  kind: EditorInputKind;
  initial: string;
  /** True when editing an existing link — enables the Remove action. */
  canRemove: boolean;
  coords: { left: number; bottom: number } | null;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

const CONFIG: Record<
  EditorInputKind,
  { label: string; placeholder: string; icon: typeof LinkIcon; mono: boolean }
> = {
  link: {
    label: "Link",
    placeholder: "Paste or type a URL",
    icon: LinkIcon,
    mono: false,
  },
  "inline-math": {
    label: "Inline math",
    placeholder: "a^2 + b^2 = c^2",
    icon: Sigma,
    mono: true,
  },
  "block-math": {
    label: "Block math",
    placeholder: "\\int_0^\\infty e^{-x}\\,dx = 1",
    icon: Sigma,
    mono: true,
  },
};

export function EditorInputPopover({
  kind,
  initial,
  canRemove,
  coords,
  onSubmit,
  onCancel,
}: EditorInputPopoverProps) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  const cfg = CONFIG[kind];
  const Icon = cfg.icon;

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, []);

  if (!coords) return null;

  return (
    <AnimatePresence>
      <motion.div
        key={`input-${kind}`}
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.12, ease: EASE }}
        role="dialog"
        aria-label={cfg.label}
        style={{
          position: "fixed",
          left: Math.min(coords.left, window.innerWidth - POPOVER_WIDTH - 12),
          top: Math.min(coords.bottom + 6, window.innerHeight - 140),
          width: POPOVER_WIDTH,
          zIndex: 60,
        }}
        className="bg-background border border-border shadow-[0_16px_40px_-16px_rgba(0,0,0,0.3)]"
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-foreground/[0.02]">
          <Icon size={12} strokeWidth={2} className="text-violet" />
          <span className="text-[11px] uppercase tracking-[0.14em] text-violet font-semibold">
            {cfg.label}
          </span>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onCancel();
            }}
            aria-label="Cancel"
            className="ml-auto p-1 text-muted hover:text-foreground transition-colors"
          >
            <X size={11} strokeWidth={2} />
          </button>
        </div>

        <div className="p-3">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={cfg.placeholder}
            spellCheck={false}
            autoComplete="off"
            className={`w-full bg-surface border border-border focus:border-violet/50 px-3 py-2 text-[13px] text-foreground placeholder:text-muted focus:outline-none transition-colors ${
              cfg.mono ? "font-mono" : ""
            }`}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSubmit(value);
              } else if (e.key === "Escape") {
                e.preventDefault();
                onCancel();
              }
            }}
          />

          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onSubmit(value);
              }}
              className="flex items-center gap-1.5 bg-violet text-white text-[10px] font-medium uppercase tracking-[0.12em] px-3 py-1.5 hover:bg-violet/90 transition-colors"
            >
              <Check size={12} strokeWidth={2.25} />
              Apply
            </button>
            {canRemove ? (
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSubmit("");
                }}
                className="flex items-center gap-1.5 text-muted border border-border text-[10px] font-medium uppercase tracking-[0.12em] px-3 py-1.5 hover:text-foreground hover:border-foreground/30 transition-colors"
              >
                <Trash2 size={12} />
                Remove
              </button>
            ) : null}
            <span className="ml-auto text-[10px] text-muted">
              <kbd className="font-mono text-foreground">↵</kbd> apply ·{" "}
              <kbd className="font-mono text-foreground">esc</kbd> cancel
            </span>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * Best-effort URL normalisation for the link popover: bare domains get
 * an https:// scheme; existing schemes, mailto/tel, anchors and
 * absolute paths are left untouched.
 */
export function normalizeUrl(raw: string): string {
  const v = raw.trim();
  if (!v) return v;
  if (/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(v)) return v;
  if (/^[^\s.]+\.[^\s]+/.test(v)) return `https://${v}`;
  return v;
}
