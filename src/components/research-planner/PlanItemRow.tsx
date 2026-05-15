"use client";

/**
 * PlanItemRow — single entry in the active plan list.
 *
 * Status pill on the left (open / in-progress / done / archived),
 * title, optional notes, and a compact action menu (cycle status,
 * delete).
 *
 * Status cycling is one tap on the pill — open → in-progress → done →
 * (back to open). Archive is in the … menu.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, Circle, CircleDot, Archive, Trash2, MoreHorizontal } from "lucide-react";
import type { PlanItem, PlanItemStatus, SuggestionKind } from "@/lib/research-planner";

const STATUS_META: Record<
  PlanItemStatus,
  { label: string; icon: typeof Check; classes: string }
> = {
  open: {
    label: "Open",
    icon: Circle,
    classes: "text-foreground/60 border-foreground/20",
  },
  "in-progress": {
    label: "In progress",
    icon: CircleDot,
    classes: "text-cyan border-cyan/40 bg-cyan/[0.06]",
  },
  done: {
    label: "Done",
    icon: Check,
    classes: "text-violet border-violet/40 bg-violet/[0.06]",
  },
  archived: {
    label: "Archived",
    icon: Archive,
    classes: "text-foreground/35 border-foreground/10",
  },
};

const KIND_LABEL: Record<SuggestionKind, string> = {
  "undersupported-claim": "Claim gap",
  "underread-topic": "Thin coverage",
  contradiction: "Contradiction",
};

interface Props {
  item: PlanItem;
  onCycleStatus: (item: PlanItem) => void;
  onArchive: (item: PlanItem) => void;
  onDelete: (item: PlanItem) => void;
}

export default function PlanItemRow({
  item,
  onCycleStatus,
  onArchive,
  onDelete,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const status = STATUS_META[item.status];
  const StatusIcon = status.icon;
  const kindLabel = item.kind ? KIND_LABEL[item.kind] : item.origin === "manual" ? "Manual" : "";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
      className="group flex items-start gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-foreground/[0.025]"
    >
      <button
        type="button"
        onClick={() => onCycleStatus(item)}
        className={`mt-0.5 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] transition-colors ${status.classes}`}
        title="Click to cycle status"
      >
        <StatusIcon size={11} strokeWidth={2} />
        <span>{status.label}</span>
      </button>

      <div className="min-w-0 flex-1">
        <div
          className={`font-display text-[15px] leading-snug ${
            item.status === "done" || item.status === "archived"
              ? "text-foreground/45 line-through"
              : "text-foreground"
          }`}
        >
          {item.title}
        </div>
        {(item.notes || kindLabel) && (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-foreground/50">
            {kindLabel && (
              <span className="rounded bg-foreground/[0.04] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em]">
                {kindLabel}
              </span>
            )}
            {item.notes && (
              <span className="line-clamp-1 italic">{item.notes}</span>
            )}
          </div>
        )}
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="rounded p-1.5 text-foreground/40 opacity-0 transition-all group-hover:opacity-100 hover:bg-foreground/[0.05] hover:text-foreground/70"
          aria-label="More"
        >
          <MoreHorizontal size={15} strokeWidth={1.75} />
        </button>
        {menuOpen && (
          <>
            <button
              type="button"
              aria-hidden="true"
              tabIndex={-1}
              className="fixed inset-0 z-30 cursor-default"
              onClick={() => setMenuOpen(false)}
            />
            <div className="absolute right-0 top-full z-40 mt-1 w-44 overflow-hidden rounded-lg border border-foreground/15 bg-background shadow-lg">
              <button
                type="button"
                onClick={() => {
                  onArchive(item);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-foreground/80 hover:bg-foreground/[0.04]"
              >
                <Archive size={13} strokeWidth={1.75} />
                Archive
              </button>
              <button
                type="button"
                onClick={() => {
                  onDelete(item);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-rose hover:bg-rose/[0.06]"
              >
                <Trash2 size={13} strokeWidth={1.75} />
                Delete
              </button>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}
