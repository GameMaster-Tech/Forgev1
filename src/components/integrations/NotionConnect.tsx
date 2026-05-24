"use client";

/**
 * NotionConnect — settings panel for the Notion integration.
 *
 * Three visual states:
 *   1. Not configured (env vars missing) — explanatory message, no CTA.
 *   2. Disconnected   — Connect button.
 *   3. Connected      — workspace name, last-synced, Sync now, Disconnect.
 *
 * Sync runs synchronously when the user clicks (long requests are
 * fine — the route is Node runtime with maxDuration: 300). Surfaces
 * the resulting stats inline.
 */

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCcw,
  Sparkles,
  Unplug,
} from "lucide-react";
import {
  connectNotion,
  disconnectNotion,
  refreshNotionState,
  runNotionSync,
  type NotionIntegrationState,
} from "@/lib/notion/client";

const EASE = [0.22, 0.61, 0.36, 1] as const;

export function NotionConnect() {
  const [state, setState] = useState<NotionIntegrationState>({ status: "disconnected" });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<
    | null
    | {
        ok: boolean;
        message: string;
        stats?: {
          projects?: number;
          documents?: number;
          events?: number;
          databases?: number;
        };
      }
  >(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await refreshNotionState();
      if (cancelled) return;
      setState(s);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onConnect = useCallback(async () => {
    setSyncResult(null);
    const s = await connectNotion();
    setState(s);
  }, []);

  const onDisconnect = useCallback(async () => {
    setSyncResult(null);
    const s = await disconnectNotion();
    setState(s);
  }, []);

  const onSync = useCallback(async () => {
    setSyncing(true);
    setSyncResult(null);
    const result = await runNotionSync();
    setSyncing(false);
    if (!result.ok) {
      setSyncResult({ ok: false, message: result.error ?? "Sync failed" });
      const fresh = await refreshNotionState();
      setState(fresh);
      return;
    }
    setSyncResult({
      ok: true,
      message: "Notion workspace synced.",
      stats: {
        projects: result.createdProjects,
        documents: result.upsertedDocuments,
        events: result.upsertedEvents,
        databases: result.scannedDatabases,
      },
    });
    const fresh = await refreshNotionState();
    setState(fresh);
  }, []);

  if (loading) {
    return (
      <div className="border border-border bg-surface p-6 flex items-center gap-3 text-[12px] text-muted">
        <Loader2 size={14} className="animate-spin text-violet" />
        Checking Notion connection…
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE }}
      className="border border-border bg-surface overflow-hidden"
    >
      <div className="flex items-start gap-4 px-6 py-5 border-b border-border">
        <NotionMark />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] uppercase tracking-[0.18em] font-semibold text-foreground">
              Notion
            </span>
            <StatusPill state={state} />
          </div>
          <p className="text-[12.5px] text-muted leading-relaxed max-w-md">
            Pull your Notion workspace into Forge. Pages become documents,
            databases with dates become calendar events, the rest become
            tables. Re-syncing updates in place — never duplicates.
          </p>
        </div>
      </div>

      {/* Not-configured state */}
      {state.configured === false ? (
        <div className="px-6 py-5 bg-warm/[0.04] border-b border-warm/30 text-[12px] text-warm flex items-start gap-2.5">
          <AlertTriangle size={13} strokeWidth={2} className="shrink-0 mt-0.5" />
          <span>
            Notion OAuth isn&apos;t configured on this server. Set{" "}
            <code className="font-mono">NOTION_OAUTH_CLIENT_ID</code>,{" "}
            <code className="font-mono">NOTION_OAUTH_CLIENT_SECRET</code>, and{" "}
            <code className="font-mono">NOTION_OAUTH_REDIRECT_URI</code> in your
            <code className="font-mono"> .env.local</code> and restart.
          </span>
        </div>
      ) : null}

      {/* Body — connected vs disconnected */}
      {state.status === "connected" && state.account ? (
        <div className="divide-y divide-border">
          <DetailRow label="Workspace" value={state.account.workspaceName} />
          {state.account.ownerEmail ? (
            <DetailRow label="Connected as" value={state.account.ownerEmail} />
          ) : null}
          <DetailRow
            label="Last synced"
            value={state.lastSyncedAt ? relTime(state.lastSyncedAt) : "Never"}
          />
          {state.stats ? (
            <DetailRow
              label="Imported"
              value={`${state.stats.projects} project${state.stats.projects === 1 ? "" : "s"} · ${state.stats.documents} doc${state.stats.documents === 1 ? "" : "s"} · ${state.stats.events} event${state.stats.events === 1 ? "" : "s"}`}
            />
          ) : null}
        </div>
      ) : null}

      {/* Sync result banner */}
      <AnimatePresence>
        {syncResult ? (
          <motion.div
            key={syncResult.ok ? "ok" : "err"}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: EASE }}
            className={`px-6 py-3 border-b text-[12px] flex items-start gap-2.5 ${
              syncResult.ok
                ? "bg-green/[0.05] border-green/30 text-green"
                : "bg-rose/[0.04] border-rose/30 text-rose"
            }`}
          >
            {syncResult.ok ? (
              <CheckCircle2 size={13} strokeWidth={2} className="shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle size={13} strokeWidth={2} className="shrink-0 mt-0.5" />
            )}
            <div>
              <div>{syncResult.message}</div>
              {syncResult.ok && syncResult.stats ? (
                <div className="text-[11px] text-foreground/70 mt-0.5 tabular-nums">
                  {syncResult.stats.projects ?? 0} projects ·{" "}
                  {syncResult.stats.documents ?? 0} docs ·{" "}
                  {syncResult.stats.events ?? 0} events ·{" "}
                  {syncResult.stats.databases ?? 0} databases
                </div>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Action row */}
      <div className="flex items-center justify-end gap-2 px-6 py-4 bg-background/40">
        {state.status === "connected" ? (
          <>
            <button
              type="button"
              onClick={onDisconnect}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] font-semibold border border-border text-muted hover:text-rose hover:border-rose/40 disabled:opacity-50 transition-colors"
            >
              <Unplug size={11} strokeWidth={2} />
              Disconnect
            </button>
            <button
              type="button"
              onClick={onSync}
              disabled={syncing}
              className="inline-flex items-center gap-2 px-4 py-1.5 text-[11px] uppercase tracking-[0.14em] font-bold text-white bg-violet hover:bg-violet/90 disabled:opacity-50 transition-colors"
            >
              {syncing ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCcw size={12} strokeWidth={2.25} />
              )}
              {syncing ? "Syncing…" : "Sync now"}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onConnect}
            disabled={state.configured === false}
            className="inline-flex items-center gap-2 px-4 py-1.5 text-[11px] uppercase tracking-[0.14em] font-bold text-white bg-violet hover:bg-violet/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Sparkles size={12} strokeWidth={2.25} />
            Connect Notion
            <ExternalLink size={10} strokeWidth={2} className="opacity-70" />
          </button>
        )}
      </div>
    </motion.div>
  );
}

function StatusPill({ state }: { state: NotionIntegrationState }) {
  if (state.status === "connected") {
    return (
      <span className="text-[9px] uppercase tracking-[0.16em] font-semibold text-green inline-flex items-center gap-1">
        <span aria-hidden className="w-1.5 h-1.5 bg-green rounded-full" />
        Connected
      </span>
    );
  }
  if (state.status === "revoked") {
    return (
      <span className="text-[9px] uppercase tracking-[0.16em] font-semibold text-rose inline-flex items-center gap-1">
        <span aria-hidden className="w-1.5 h-1.5 bg-rose rounded-full" />
        Reconnect
      </span>
    );
  }
  return (
    <span className="text-[9px] uppercase tracking-[0.16em] font-semibold text-muted inline-flex items-center gap-1">
      <span aria-hidden className="w-1.5 h-1.5 bg-muted rounded-full" />
      Not connected
    </span>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-6 py-3">
      <span className="text-[10px] uppercase tracking-[0.16em] text-muted font-medium">
        {label}
      </span>
      <span className="text-[12.5px] text-foreground text-right">{value}</span>
    </div>
  );
}

function NotionMark() {
  return (
    <div className="w-10 h-10 border border-border bg-background flex items-center justify-center shrink-0">
      <span className="font-display font-black text-foreground text-[16px] leading-none">
        N
      </span>
    </div>
  );
}

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}
