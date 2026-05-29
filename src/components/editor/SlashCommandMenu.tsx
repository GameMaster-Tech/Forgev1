"use client";

/**
 * SlashCommandMenu — the floating block-insert palette for ForgeEditor.
 *
 * Positioned at the caret (fixed coords supplied by the editor via
 * `coordsAtPos`). The editor owns keyboard navigation (it intercepts
 * ArrowUp/Down/Enter/Esc in `handleKeyDown` so the menu and the
 * ProseMirror selection never fight), so this component is purely
 * presentational + mouse interaction. Visual language matches
 * ComposerCommandsMenu so the two pickers feel like one system.
 */

import { motion, AnimatePresence } from "framer-motion";
import { CornerDownLeft, Slash } from "lucide-react";
import type { SlashCommand } from "./slashCommands";

const EASE = [0.22, 0.61, 0.36, 1] as const;
const MENU_WIDTH = 280;
const MENU_MAX_HEIGHT = 320;

export interface SlashCommandMenuProps {
  open: boolean;
  query: string;
  items: SlashCommand[];
  activeIndex: number;
  /** Viewport coords of the caret, from editor.view.coordsAtPos. */
  coords: { left: number; bottom: number } | null;
  onPick: (index: number) => void;
  onHover: (index: number) => void;
}

export function SlashCommandMenu({
  open,
  query,
  items,
  activeIndex,
  coords,
  onPick,
  onHover,
}: SlashCommandMenuProps) {
  return (
    <AnimatePresence>
      {open && coords ? (
        <motion.div
          key="slash-menu"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.12, ease: EASE }}
          role="listbox"
          aria-label="Insert block"
          style={{
            position: "fixed",
            left: Math.min(coords.left, window.innerWidth - MENU_WIDTH - 12),
            top: Math.min(coords.bottom + 6, window.innerHeight - MENU_MAX_HEIGHT - 12),
            width: MENU_WIDTH,
            zIndex: 60,
          }}
          className="bg-background border border-border shadow-[0_16px_40px_-16px_rgba(0,0,0,0.3)]"
        >
          {/* Mode header */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-foreground/[0.02]">
            <Slash size={12} strokeWidth={2} className="text-violet" />
            <span className="text-[11px] uppercase tracking-[0.14em] text-violet font-semibold">
              Insert block
            </span>
            {query ? (
              <span className="text-[11px] text-muted truncate">
                · &ldquo;{query}&rdquo;
              </span>
            ) : null}
          </div>

          {items.length === 0 ? (
            <div className="px-3 py-4 text-[12px] text-muted leading-relaxed">
              No matching blocks.
            </div>
          ) : (
            <ul className="py-1 overflow-y-auto" style={{ maxHeight: MENU_MAX_HEIGHT - 72 }}>
              {items.map((it, i) => {
                const Icon = it.icon;
                return (
                  <li key={it.id}>
                    <button
                      type="button"
                      role="option"
                      onMouseDown={(e) => {
                        // mousedown (not click) so the editor keeps the
                        // selection before we mutate it.
                        e.preventDefault();
                        onPick(i);
                      }}
                      onMouseEnter={() => onHover(i)}
                      aria-selected={activeIndex === i}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                        activeIndex === i
                          ? "bg-violet/[0.08]"
                          : "hover:bg-foreground/[0.04]"
                      }`}
                    >
                      <div
                        className={`w-7 h-7 border flex items-center justify-center shrink-0 transition-colors ${
                          activeIndex === i ? "border-violet/40" : "border-border"
                        }`}
                      >
                        <Icon
                          size={13}
                          strokeWidth={2}
                          className={activeIndex === i ? "text-violet" : "text-muted"}
                        />
                      </div>
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
                );
              })}
            </ul>
          )}

          <div className="flex items-center justify-between gap-3 px-3 py-1.5 border-t border-border bg-foreground/[0.02] text-[10px] text-muted">
            <span>
              <kbd className="font-mono text-foreground">↑↓</kbd> navigate ·{" "}
              <kbd className="font-mono text-foreground">↵</kbd> select ·{" "}
              <kbd className="font-mono text-foreground">esc</kbd> close
            </span>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
