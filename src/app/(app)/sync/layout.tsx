"use client";

/**
 * Sync — section layout.
 *
 * Wraps every /sync/* page in <SyncProvider> so the five sub-routes
 * (Overview, Conflicts, Patch, Documents, History) read from the
 * same graph. Header mirrors /projects + /teams: static title,
 * description, and a right-side action strip (Reset + Compile).
 * Dynamic verdicts live on the Overview page, not in the header —
 * so the header stays calm and the route-tab strip below stays the
 * visual anchor for navigation.
 */

import { motion } from "framer-motion";
import {
  ArrowRight,
  GitBranch,
  Loader2,
  RotateCcw,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { SectionSubNav, type SubNavItem } from "@/components/app/SectionSubNav";
import { SyncProvider, useSync } from "./SyncProvider";
import { ease } from "./_components";

type NavRoute = {
  href: string;
  label: string;
  icon: LucideIcon;
  badgeKey: "conflicts" | "patch" | null;
};

const SUBNAV: NavRoute[] = [
  { href: "/sync",            label: "Overview",  icon: Sparkles,   badgeKey: null },
  { href: "/sync/conflicts",  label: "Conflicts", icon: GitBranch,  badgeKey: "conflicts" },
  { href: "/sync/patch",      label: "Patch",     icon: ArrowRight, badgeKey: "patch" },
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

  const items: SubNavItem[] = SUBNAV.map(({ badgeKey, ...rest }) => {
    let badge: number | null = null;
    if (badgeKey === "conflicts") badge = conflictsCount || null;
    else if (badgeKey === "patch") badge = hasPatch ? patchChanges || 1 : null;
    return { ...rest, badge };
  });
  // No longer surfaced after Documents/History tabs were removed.
  void documentsCount;
  void historyCount;

  return (
    <div className="min-h-full bg-background">
      <motion.header
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease }}
        className="border-b border-border px-6 sm:px-10 pt-10 pb-6"
      >
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-2 flex items-center gap-2">
              <GitBranch size={11} strokeWidth={1.75} />
              Sync
            </p>
            <h1 className="font-display font-extrabold text-3xl sm:text-4xl text-foreground tracking-[-0.025em] leading-[1.05]">
              Check for conflicts.
            </h1>
            <p className="text-[13px] text-muted mt-2 max-w-xl leading-relaxed">
              Sync scans your documents for numbers that contradict each other and suggests a single fix to make everything line up.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={resetDemo}
              className="flex items-center gap-2 border border-border text-foreground hover:border-violet hover:text-violet text-[11px] font-semibold uppercase tracking-[0.12em] px-4 py-2.5 transition-colors duration-150"
            >
              <RotateCcw size={12} strokeWidth={2.25} />
              Reset
            </button>
            <button
              onClick={compile}
              disabled={computing}
              className="flex items-center gap-2 bg-violet text-white hover:bg-violet/90 disabled:opacity-60 text-[11px] font-semibold uppercase tracking-[0.12em] px-5 py-2.5 transition-colors duration-150"
            >
              {computing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} strokeWidth={2.25} />}
              Compile
            </button>
          </div>
        </div>
      </motion.header>

      <SectionSubNav items={items} layoutId="sync-subnav" />

      <main>{children}</main>
    </div>
  );
}
