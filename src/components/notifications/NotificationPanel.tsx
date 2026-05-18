"use client";

/**
 * NotificationPanel — list of notification rows inside the bell
 * drop-down. Click a row to mark it read + (optional) route to its href.
 */

import Link from "next/link";
import type { Notification, NotificationKind, NotificationSeverity } from "@/lib/notifications";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  AlertCircle,
  GitBranch,
  Activity,
  Network,
  Brain,
  Flame,
  Users,
  Cable,
} from "lucide-react";

interface Props {
  items: Notification[];
  onMarkRead: (id: string) => void;
  onClose: () => void;
}

const SEVERITY_TONE: Record<NotificationSeverity, string> = {
  info:    "text-cyan",
  success: "text-green",
  warn:    "text-warm",
  error:   "text-rose",
};

const KIND_ICON: Record<NotificationKind, typeof Info> = {
  "sync.conflict":           GitBranch,
  "sync.compiled":           GitBranch,
  "pulse.invalidation":      Activity,
  "pulse.refactor.queued":   Activity,
  "lattice.rebranch":        Network,
  "tempo.overload":          Brain,
  "habit.nudge":             Flame,
  "habit.streak.milestone":  Flame,
  "sharing.invited":         Users,
  "sharing.revoked":         Users,
  "integration.connected":   Cable,
  "integration.error":       Cable,
};

export function NotificationPanel({ items, onMarkRead, onClose }: Props) {
  if (items.length === 0) {
    return (
      <div className="px-6 py-12 text-center">
        <div className="mx-auto w-10 h-10 border border-border bg-surface flex items-center justify-center mb-2">
          <CheckCircle2 size={14} className="text-green" />
        </div>
        <p className="text-[13px] text-foreground font-medium">Caught up.</p>
        <p className="text-[12px] text-muted mt-1 leading-relaxed">Nothing demands your attention right now.</p>
      </div>
    );
  }

  return (
    <ul className="max-h-[400px] overflow-y-auto divide-y divide-border">
      {items.map((n) => {
        const Icon = KIND_ICON[n.kind];
        const tone = SEVERITY_TONE[n.severity];
        const rowClass = "block w-full text-left px-4 py-3 hover:bg-violet/[0.08] transition-colors";
        const body = (
          <div className="flex items-start gap-3">
            <div className={`w-6 h-6 border border-border bg-background flex items-center justify-center shrink-0 ${tone}`}>
              <Icon size={11} strokeWidth={2} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {!n.read && <span className="w-1.5 h-1.5 bg-violet" aria-label="unread" />}
                <SeverityIcon severity={n.severity} className={tone} />
                <span className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted">{n.kind}</span>
                <span className="text-[10px] text-muted">·</span>
                <span className="text-[10px] uppercase tracking-[0.12em] text-muted tabular-nums">
                  {timeAgo(n.at)}
                </span>
              </div>
              <p className="text-[13px] text-foreground font-medium mt-1 leading-tight">{n.title}</p>
              {n.summary && <p className="text-[11.5px] text-muted leading-relaxed mt-0.5">{n.summary}</p>}
            </div>
          </div>
        );
        return (
          <li key={n.id} className={`relative ${n.read ? "" : "bg-violet/[0.04]"}`}>
            {n.href ? (
              <Link href={n.href} onClick={() => { onMarkRead(n.id); onClose(); }} className={rowClass}>
                {body}
              </Link>
            ) : (
              <button type="button" onClick={() => onMarkRead(n.id)} className={rowClass}>
                {body}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function SeverityIcon({ severity, className }: { severity: NotificationSeverity; className?: string }) {
  const Icon =
    severity === "error" ? AlertCircle :
    severity === "warn" ? AlertTriangle :
    severity === "success" ? CheckCircle2 : Info;
  return <Icon size={10} className={className} strokeWidth={2} />;
}

function timeAgo(ms: number): string {
  const diff = Math.max(0, Date.now() - ms);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  return `${d}d`;
}
