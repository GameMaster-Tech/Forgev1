"use client";

/**
 * PreferencesPane — opt-in toggles per notification kind. Persisted
 * to localStorage via lib/notifications/preferences.
 */

import { useEffect, useState } from "react";
import {
  readPreferences,
  setPreference,
  type NotificationPreferences,
  type NotificationKind,
} from "@/lib/notifications";

const PREF_ROWS: { key: NotificationKind; label: string; desc: string }[] = [
  { key: "sync.conflict",          label: "Sync · conflicts",         desc: "When a workspace constraint is violated." },
  { key: "sync.compiled",          label: "Sync · compiled clean",    desc: "Confirmation when the workspace reaches a stable state." },
  { key: "pulse.invalidation",     label: "Pulse · invalidations",    desc: "A tracked claim drifted past the reality threshold." },
  { key: "pulse.refactor.queued",  label: "Pulse · refactor queued",  desc: "New document refactor proposed." },
  { key: "lattice.rebranch",       label: "Lattice · rebranch",       desc: "Task tree restructured. Noisy — opt-in if you want it." },
  { key: "tempo.overload",         label: "Tempo · overload",         desc: "A day is predicted to exceed your capacity." },
  { key: "habit.nudge",            label: "Habit · nudge",            desc: "A daily habit hasn't been completed yet." },
  { key: "habit.streak.milestone", label: "Habit · streak milestone", desc: "Streak crossed 7, 30, 100 days." },
  { key: "sharing.invited",        label: "Sharing · invited",        desc: "Someone shared a project / event with you." },
  { key: "sharing.revoked",        label: "Sharing · revoked",        desc: "An owner revoked your access." },
  { key: "integration.connected",  label: "Integration · connected",  desc: "Google Calendar / Outlook / etc. linked." },
  { key: "integration.error",      label: "Integration · error",      desc: "Sync failed or your token expired." },
];

export function PreferencesPane() {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);

  useEffect(() => {
    // localStorage hydrate — SSR-safe one-shot.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrefs(readPreferences());
  }, []);

  if (!prefs) return null;

  const toggle = (k: NotificationKind) => {
    const next = setPreference(k, !prefs[k]);
    setPrefs(next);
  };

  return (
    <div className="max-h-[400px] overflow-y-auto divide-y divide-border">
      {PREF_ROWS.map((row) => (
        <label
          key={row.key}
          className="flex items-start gap-3 px-4 py-3 hover:bg-violet/[0.04] transition-colors cursor-pointer"
        >
          <input
            type="checkbox"
            checked={prefs[row.key]}
            onChange={() => toggle(row.key)}
            className="mt-1 accent-violet w-3.5 h-3.5 shrink-0"
          />
          <div className="flex-1 min-w-0">
            <div className="text-[12.5px] text-foreground font-medium">{row.label}</div>
            <p className="text-[11px] text-muted leading-relaxed mt-0.5">{row.desc}</p>
          </div>
        </label>
      ))}
      <p className="px-4 py-3 text-[10px] uppercase tracking-[0.12em] text-muted">
        Preferences persist to this browser. Email + push delivery — coming soon.
      </p>
    </div>
  );
}
