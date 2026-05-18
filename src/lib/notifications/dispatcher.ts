/**
 * Dispatcher — the single entry point components call to surface a
 * notification. Honors preferences before writing.
 */

import { isEnabled } from "./preferences";
import { getNotificationStore } from "./store";
import type { Notification, NotificationKind, NotificationSeverity } from "./types";

export interface DispatchArgs {
  kind: NotificationKind;
  severity?: NotificationSeverity;
  title: string;
  summary: string;
  href?: string;
  projectId?: string;
  uid?: string;
  detail?: Record<string, unknown>;
  /** Bypass preferences (use sparingly, e.g. security-critical). */
  force?: boolean;
}

export function dispatchNotification(args: DispatchArgs): Notification | null {
  if (!args.force && !isEnabled(args.kind)) return null;
  return getNotificationStore().push({
    kind: args.kind,
    severity: args.severity ?? defaultSeverity(args.kind),
    title: args.title,
    summary: args.summary,
    href: args.href,
    projectId: args.projectId,
    uid: args.uid,
    detail: args.detail,
  });
}

function defaultSeverity(kind: NotificationKind): NotificationSeverity {
  switch (kind) {
    case "sync.conflict":
    case "pulse.invalidation":
    case "tempo.overload":
    case "integration.error":
      return "warn";
    case "sync.compiled":
    case "habit.streak.milestone":
    case "sharing.invited":
    case "integration.connected":
      return "success";
    case "pulse.refactor.queued":
    case "lattice.rebranch":
    case "habit.nudge":
    case "sharing.revoked":
      return "info";
  }
}
