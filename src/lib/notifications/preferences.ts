/**
 * Notification preferences — localStorage-persisted opt-in map keyed
 * by NotificationKind. Pure data layer.
 */

import { DEFAULT_PREFERENCES, type NotificationKind, type NotificationPreferences } from "./types";

const STORAGE_KEY = "forge.notifications.prefs.v1";

export function readPreferences(): NotificationPreferences {
  if (typeof window === "undefined") return { ...DEFAULT_PREFERENCES };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES };
    const parsed = JSON.parse(raw) as Partial<NotificationPreferences>;
    return { ...DEFAULT_PREFERENCES, ...parsed };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function writePreferences(prefs: NotificationPreferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {/* swallow */}
}

export function setPreference(kind: NotificationKind, enabled: boolean): NotificationPreferences {
  const current = readPreferences();
  const next = { ...current, [kind]: enabled };
  writePreferences(next);
  return next;
}

export function isEnabled(kind: NotificationKind): boolean {
  return readPreferences()[kind];
}
