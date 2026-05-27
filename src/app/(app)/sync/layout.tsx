"use client";

/**
 * Checks — section layout.
 *
 * Minimal header pattern shared with /pulse and /calendar after the
 * redesign sweep: one-line title + 1-line caption + a single primary
 * action (Compile) and an overflow for Reset. The dynamic status
 * (verdict card, conflict counts) lives on the Overview page, not the
 * layout — so navigating between sub-routes never refreshes the
 * header.
 *
 * Renamed Sync → Checks in user-facing copy; the route stays /sync so
 * existing bookmarks survive.
 */

import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  Check as CheckIcon,
  GitBranch,
  Loader2,
  MoreHorizontal,
  RotateCcw,
} from "lucide-react";
import { useRef, useState } from "react";
import { SectionSubNav, type SubNavItem } from "@/components/app/SectionSubNav";
import { SyncProvider, useSync } from "./SyncProvider";
import { ease } from "./_components";

interface NavRoute {
  href: string;
  label: string;
  badgeKey: "conflicts" | "patch" | null;
}

const SUBNAV: NavRoute[] = [
  { href: "/sync", label: "Overview", badgeKey: null },
  { href: "/sync/conflicts", label: "Conflicts", badgeKey: "conflicts" },
  { href: "/sync/patch", label: "Patch", badgeKey: "patch" },
];

export default function SyncLayout({ children }: { children: React.ReactNode }) {
  return (
    <SyncProvider>
      <SyncShell>{children}</SyncShell>
    </SyncProvider>
  );
}

function SyncShell({ children }: { children: React.ReactNode }) {
  const {
    conflictsCount,
    hasPatch,
    patchChanges,
    documentsCount,
    historyCount,
    computing,
    compile,
    resetDemo,
  } = useSync();

  const items: SubNavItem[] = SUBNAV.map(({ badgeKey, href, label }) => ({
    href,
    label,
    icon: badgeKey === "conflicts" ? GitBranch : badgeKey === "patch" ? ArrowRight : CheckIcon,
    badge:
      badgeKey === "conflicts"
        ? conflictsCount || null
        : badgeKey === "patch"
          ? hasPatch
            ? patchChanges || 1
            : null
          : null,
  }));
  void documentsCount;
  void historyCount;

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  return (
    <div className="min-h-full bg-background">
      <motion.header
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease }}
        className="border-b border-border px-6 sm:px-10 pt-7 pb-4"
      >
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display font-bold text-[22px] sm:text-[26px] text-foreground tracking-[-0.02em] leading-[1.1]">
              Checks
            </h1>
            <p className="text-[12.5px] text-muted mt-1 max-w-xl leading-relaxed">
              Catches numbers and claims across your docs that contradict each other.
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={compile}
              disabled={computing}
              className="inline-flex items-center gap-1.5 bg-violet text-white hover:bg-violet/90 disabled:opacity-60 text-[11px] font-semibold uppercase tracking-[0.14em] px-3.5 py-2 transition-colors"
            >
              {computing ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <CheckIcon size={12} strokeWidth={2.25} />
              )}
              Run check
            </button>
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="More"
                className="p-2 text-muted hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
              >
                <MoreHorizontal size={14} strokeWidth={1.75} />
              </button>
              <AnimatePresence>
                {menuOpen ? (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setMenuOpen(false)}
                      aria-hidden
                    />
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.14 }}
                      className="absolute right-0 top-full mt-1 w-40 bg-background border border-border shadow-[0_16px_32px_-16px_rgba(0,0,0,0.25)] z-50"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          resetDemo();
                        }}
                        className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] text-foreground/80 hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
                      >
                        <RotateCcw size={12} strokeWidth={1.75} />
                        Reset state
                      </button>
                    </motion.div>
                  </>
                ) : null}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </motion.header>

      <SectionSubNav items={items} layoutId="sync-subnav" />

      <main>{children}</main>
    </div>
  );
}
