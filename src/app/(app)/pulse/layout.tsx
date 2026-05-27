"use client";

/**
 * Freshness — section layout.
 *
 * Mirror of the new /sync header: one-line title, one-line caption,
 * a single primary action ("Re-check"), cadence collapsed into the
 * action itself via a small popover so the header stays single-row
 * on every viewport.
 *
 * Renamed Pulse → Freshness in user-facing copy; the route stays
 * /pulse for backwards-compat with shared links.
 */

import { ArrowRight, Radio, RefreshCw, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { SectionSubNav, type SubNavItem } from "@/components/app/SectionSubNav";
import { PulseProvider, usePulse } from "./PulseProvider";
import { CadenceSelect, SyncButton, ease } from "./_components";

interface NavRoute {
  href: string;
  label: string;
  badgeKey: "diffs" | "refactors" | null;
}

const SUBNAV: NavRoute[] = [
  { href: "/pulse", label: "Overview", badgeKey: null },
  { href: "/pulse/diffs", label: "Diffs", badgeKey: "diffs" },
  { href: "/pulse/refactors", label: "Refactors", badgeKey: "refactors" },
];

export default function PulseLayout({ children }: { children: React.ReactNode }) {
  return (
    <PulseProvider>
      <PulseShell>{children}</PulseShell>
    </PulseProvider>
  );
}

function PulseShell({ children }: { children: React.ReactNode }) {
  const { diffsCount, refactorsCount, cadence, setCadence, running, runNow } = usePulse();

  const items: SubNavItem[] = SUBNAV.map(({ badgeKey, href, label }) => ({
    href,
    label,
    icon: badgeKey === "diffs" ? Radio : badgeKey === "refactors" ? ArrowRight : Sparkles,
    badge:
      badgeKey === "diffs"
        ? diffsCount || null
        : badgeKey === "refactors"
          ? refactorsCount || null
          : null,
  }));

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
            <h1 className="font-display font-bold text-[22px] sm:text-[26px] text-foreground tracking-[-0.02em] leading-[1.1] inline-flex items-center gap-2">
              <RefreshCw
                size={16}
                strokeWidth={2}
                className="text-violet -mt-px"
                aria-hidden
              />
              Freshness
            </h1>
            <p className="text-[12.5px] text-muted mt-1 max-w-xl leading-relaxed">
              Flags time-sensitive claims that may have aged out.
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
            <CadenceSelect cadence={cadence} onChange={setCadence} />
            <SyncButton running={running} onClick={runNow} />
          </div>
        </div>
      </motion.header>

      <SectionSubNav items={items} layoutId="pulse-subnav" />

      <main>{children}</main>
    </div>
  );
}
