"use client";

/**
 * Calendar — section layout.
 *
 * Wraps every /calendar/* page in <CalendarProvider> so the six
 * sub-routes (Grid, Tempo, Habits, Goals, Integrations, Compiler)
 * share state. Header follows the /projects + /teams convention:
 * static title and description with a right-side action strip
 * (RealtimeIndicator + New event). Drawer + new-event modal mount
 * once here so any sub-route can open them through the provider.
 */

import { AnimatePresence, motion } from "framer-motion";
import {
  Brain,
  Cable,
  Calendar as CalendarIcon,
  Flame,
  Layers,
  Plus,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { RealtimeIndicator } from "@/components/calendar/RealtimeIndicator";
import { SectionSubNav, type SubNavItem } from "@/components/app/SectionSubNav";
import { CalendarProvider, useCalendar } from "./CalendarProvider";
import { EventDrawer, NewEventModal, ease } from "./_components";

type NavRoute = {
  href: string;
  label: string;
  icon: LucideIcon;
  badgeKey: "tempo" | "habits" | "goals" | "integrations" | "rules" | null;
};

const SUBNAV: NavRoute[] = [
  { href: "/calendar",                       label: "Calendar",     icon: CalendarIcon, badgeKey: null },
  { href: "/calendar/tempo",                 label: "Schedule",     icon: Brain,        badgeKey: "tempo" },
  { href: "/calendar/habits",                label: "Habits",       icon: Flame,        badgeKey: "habits" },
  { href: "/calendar/goals",                 label: "Goals",        icon: Layers,       badgeKey: "goals" },
  { href: "/calendar/integrations",          label: "Integrations", icon: Cable,        badgeKey: "integrations" },
  { href: "/calendar/compiler/invariants",   label: "Rules",        icon: ShieldCheck,  badgeKey: "rules" },
];

export default function CalendarLayout({ children }: { children: React.ReactNode }) {
  return (
    <CalendarProvider>
      <CalendarShell>{children}</CalendarShell>
    </CalendarProvider>
  );
}

function CalendarShell({ children }: { children: React.ReactNode }) {
  const {
    streamStatus,
    presence,
    lastSyncAt,
    openNewEvent,
    closeNewEvent,
    newEventOpen,
    cursor,
    addEvent,
    activeEvent,
    setActiveEvent,
    tempoConflicts,
    habitsDueToday,
    goalsActive,
    integrationsConnected,
    compilerEventsCount,
  } = useCalendar();

  const items: SubNavItem[] = SUBNAV.map(({ badgeKey, ...rest }) => {
    let badge: number | null = null;
    if (badgeKey === "tempo") badge = tempoConflicts || null;
    else if (badgeKey === "habits") badge = habitsDueToday || null;
    else if (badgeKey === "goals") badge = goalsActive || null;
    else if (badgeKey === "integrations") badge = integrationsConnected || null;
    return { ...rest, badge };
  });

  // compilerEventsCount intentionally unused — the Compiler tab is gone.
  void compilerEventsCount;

  return (
    <div className="min-h-full bg-background">
      {/* Minimal header — aligned with /sync (Checks) and /pulse
          (Freshness): single-line title + one-line caption + a
          primary action. RealtimeIndicator collapses into the
          action strip; it's small enough to read inline. */}
      <motion.header
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease }}
        className="border-b border-border px-6 sm:px-10 pt-7 pb-4"
      >
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display font-bold text-[22px] sm:text-[26px] text-foreground tracking-[-0.02em] leading-[1.1] inline-flex items-center gap-2">
              <CalendarIcon
                size={16}
                strokeWidth={2}
                className="text-violet -mt-px"
                aria-hidden
              />
              Calendar
            </h1>
            <p className="text-[12.5px] text-muted mt-1 max-w-xl leading-relaxed">
              Events, tasks, habits and goals — auto-arranged around your energy.
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <RealtimeIndicator status={streamStatus} presence={presence} lastSyncAt={lastSyncAt} />
            <button
              onClick={openNewEvent}
              className="inline-flex items-center gap-1.5 bg-violet text-white hover:bg-violet/90 text-[11px] font-semibold uppercase tracking-[0.14em] px-3.5 py-2 transition-colors"
            >
              <Plus size={12} strokeWidth={2.25} />
              New event
            </button>
          </div>
        </div>
      </motion.header>

      <SectionSubNav items={items} layoutId="calendar-subnav" />

      <main>{children}</main>

      <AnimatePresence>
        {activeEvent && <EventDrawer event={activeEvent} onClose={() => setActiveEvent(null)} />}
        {newEventOpen && (
          <NewEventModal cursor={cursor} onClose={closeNewEvent} onCreate={addEvent} />
        )}
      </AnimatePresence>
    </div>
  );
}
