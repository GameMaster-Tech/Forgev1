"use client";

/**
 * Pulse — section layout.
 *
 * Mirrors /projects + /teams + /sync + /calendar: static title and
 * description with a right-side action strip (cadence selector +
 * Reality-sync button). The dynamic verdict moved down into the
 * Overview page so the layout header stays calm and the sub-nav
 * stays the navigation anchor.
 */

import { Activity, ArrowRight, Radio, Sparkles, type LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import { SectionSubNav, type SubNavItem } from "@/components/app/SectionSubNav";
import { PulseProvider, usePulse } from "./PulseProvider";
import { CadenceSelect, SyncButton, ease } from "./_components";

type NavRoute = {
  href: string;
  label: string;
  icon: LucideIcon;
  badgeKey: "diffs" | "refactors" | null;
};

const SUBNAV: NavRoute[] = [
  { href: "/pulse",           label: "Overview",  icon: Sparkles,   badgeKey: null },
  { href: "/pulse/diffs",     label: "Diffs",     icon: Radio,      badgeKey: "diffs" },
  { href: "/pulse/refactors", label: "Refactors", icon: ArrowRight, badgeKey: "refactors" },
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

  const items: SubNavItem[] = SUBNAV.map(({ badgeKey, ...rest }) => {
    let badge: number | null = null;
    if (badgeKey === "diffs") badge = diffsCount || null;
    else if (badgeKey === "refactors") badge = refactorsCount || null;
    return { ...rest, badge };
  });

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
              <Activity size={11} strokeWidth={1.75} />
              Pulse
            </p>
            <h1 className="font-display font-extrabold text-3xl sm:text-4xl text-foreground tracking-[-0.025em] leading-[1.05]">
              Keep your facts fresh.
            </h1>
            <p className="text-[13px] text-muted mt-2 max-w-xl leading-relaxed">
              Pulse re-checks the numbers in your docs against the real world. When something drifts, it flags the line and offers a rewrite.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
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
