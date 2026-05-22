"use client";

/**
 * Calendar — Integrations.
 *
 * Replaces the original slab-list with an 8/4 layout: Google
 * Calendar gets a featured-row treatment (status, last-synced, refresh
 * + disconnect controls) while the upcoming providers fall into a
 * 2-col grid of compact "coming soon" cards. The rail explains the
 * three-way sync policy and conflict resolver.
 */

import { motion } from "framer-motion";
import {
  Cable,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import type { GoogleIntegrationState } from "@/lib/calendar";
import { useCalendar } from "../CalendarProvider";
import { ease } from "../_components";

const COMING_SOON: { name: string; description: string }[] = [
  { name: "Outlook · Microsoft 365", description: "Microsoft Graph API · two-way sync · OAuth" },
  { name: "iCloud · CalDAV",         description: "Read-only via Apple CalDAV · password-managed" },
  { name: "Notion Calendar",         description: "Two-way Notion DB sync · property mapping" },
];

export default function CalendarIntegrationsPage() {
  const { googleState, googleLoading, connectGoogle, disconnectGoogle, refreshGoogle } = useCalendar();

  return (
    <div className="grid grid-cols-12 gap-x-0">
      {/* ── Main column ────────────────────────────────────── */}
      <div className="col-span-12 lg:col-span-8 px-6 sm:px-10 pt-8 pb-16 lg:border-r lg:border-border">
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
          Available now
        </p>

        <GoogleFeaturedCard
          state={googleState}
          loading={googleLoading}
          onConnect={connectGoogle}
          onDisconnect={disconnectGoogle}
          onRefresh={refreshGoogle}
        />

        <div className="mt-10 pt-6 border-t border-border">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
            Coming soon
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {COMING_SOON.map((p, i) => (
              <ComingSoonCard key={p.name} name={p.name} description={p.description} order={i} />
            ))}
          </div>
        </div>
      </div>

      {/* ── Right rail ─────────────────────────────────────── */}
      <aside className="col-span-12 lg:col-span-4 px-6 sm:px-10 pt-8 pb-16 space-y-6">
        <SyncPolicyLegend />
        <SyncPolicyManifesto />
      </aside>
    </div>
  );
}

/* ── Google featured card ──────────────────────────────────── */

function GoogleFeaturedCard({
  state, loading, onConnect, onDisconnect, onRefresh,
}: {
  state: GoogleIntegrationState;
  loading: boolean;
  onConnect: () => void | Promise<void>;
  onDisconnect: () => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
}) {
  const connected = state.status === "connected";
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease }}
      className="border border-border bg-surface p-5 sm:p-6 relative"
    >
      <span aria-hidden className={`absolute left-0 top-5 bottom-5 w-[2px] ${connected ? "bg-green" : "bg-violet"}`} />
      <div className="flex items-center gap-2.5 mb-2 flex-wrap">
        <span className={`flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] font-semibold ${connected ? "text-green" : "text-violet"}`}>
          <Cable size={11} strokeWidth={2} />
          {connected ? "Connected" : "Bidirectional sync"}
        </span>
        <span className="w-1 h-1 bg-muted rounded-full" />
        <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium">
          OAuth · conflict resolver
        </span>
      </div>
      <h2 className="font-display font-bold text-foreground text-2xl sm:text-3xl tracking-[-0.022em] leading-[1.1]">
        Google Calendar
      </h2>
      <p className="text-[13px] text-muted mt-3 leading-relaxed max-w-2xl">
        {connected
          ? `Signed in as ${state.account?.email ?? "—"}. Tempo writes focus blocks and learns your routine from real history.`
          : "Tempo learns your routine from real events. The more it sees, the better the focus-block placement and overload predictions."}
      </p>

      {connected && (
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] uppercase tracking-[0.12em] text-muted tabular-nums font-medium">
          <span className="flex items-center gap-1.5 text-green">
            <CheckCircle2 size={11} strokeWidth={2} /> authenticated
          </span>
          {state.lastSyncedAt && (
            <span>
              synced {new Date(state.lastSyncedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </span>
          )}
          <span>writes focus blocks</span>
          <span>reads routine</span>
        </div>
      )}

      <div className="mt-6 flex items-center gap-2 flex-wrap">
        {connected ? (
          <>
            <button
              onClick={onRefresh}
              disabled={loading}
              className="flex items-center gap-2 border border-border text-foreground hover:border-violet hover:text-violet disabled:opacity-60 text-[11px] font-semibold uppercase tracking-[0.12em] px-4 py-2.5 transition-colors duration-150"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} strokeWidth={2.25} />}
              Refresh
            </button>
            <button
              onClick={onDisconnect}
              className="flex items-center gap-2 border border-border text-muted hover:border-rose hover:text-rose text-[11px] font-semibold uppercase tracking-[0.12em] px-4 py-2.5 transition-colors duration-150"
            >
              Disconnect
            </button>
          </>
        ) : (
          <button
            onClick={onConnect}
            disabled={loading}
            className="flex items-center gap-2 bg-violet text-white hover:bg-violet/90 disabled:opacity-60 text-[11px] font-semibold uppercase tracking-[0.12em] px-5 py-2.5 transition-colors duration-150"
          >
            {loading && <Loader2 size={12} className="animate-spin" />}
            <Cable size={12} strokeWidth={2.25} />
            Connect Google
          </button>
        )}
      </div>
    </motion.div>
  );
}

/* ── Coming-soon card ──────────────────────────────────────── */

function ComingSoonCard({
  name, description, order,
}: {
  name: string;
  description: string;
  order: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: order * 0.04, ease }}
      className="border border-border bg-surface px-5 py-4 relative"
    >
      <span aria-hidden className="absolute left-0 top-4 bottom-4 w-[2px] bg-border-light" />
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[10px] uppercase tracking-[0.15em] text-muted font-semibold">
          Provider
        </span>
        <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-semibold">
          Soon
        </span>
      </div>
      <h3 className="font-display font-bold text-foreground text-[16px] sm:text-[17px] tracking-[-0.018em] leading-tight">
        {name}
      </h3>
      <p className="text-[12px] text-muted leading-relaxed mt-1">{description}</p>
    </motion.div>
  );
}

/* ── Rail: sync policy legend ──────────────────────────────── */

function SyncPolicyLegend() {
  const rows = [
    { label: "Three-way diff",     hint: "Workspace ↔ remote ↔ last-known-good keeps every side honest." },
    { label: "Conflict resolver",  hint: "Prefer local, prefer remote, or prefer the newer write." },
    { label: "Backoff with jitter",hint: "Rate-limit hits never thunder back at the provider." },
  ];
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.1, ease }}
    >
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
        Sync mechanics
      </p>
      <div className="border border-border bg-surface divide-y divide-border">
        {rows.map((r) => (
          <div key={r.label} className="flex items-start gap-3.5 px-4 py-3.5">
            <div className="mt-0.5 w-6 h-6 border border-border bg-background flex items-center justify-center shrink-0">
              <Cable size={11} strokeWidth={1.75} className="text-cyan" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-cyan">
                {r.label}
              </div>
              <p className="text-[12px] text-muted leading-relaxed mt-0.5">{r.hint}</p>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

/* ── Rail: manifesto ───────────────────────────────────────── */

function SyncPolicyManifesto() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.18, ease }}
      className="border border-border bg-foreground text-background p-5 relative overflow-hidden"
    >
      <span aria-hidden className="absolute top-0 left-0 w-[2px] h-full bg-violet" />
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={12} strokeWidth={2} className="text-violet" />
        <span className="text-[10px] uppercase tracking-[0.18em] text-background/60 font-medium">
          How sync works
        </span>
      </div>
      <h3 className="font-display font-bold text-[18px] tracking-[-0.018em] leading-[1.2] mb-3">
        Bidirectional. <span className="text-violet">Conflict-aware.</span>
      </h3>
      <p className="text-[13px] text-background/70 leading-relaxed">
        Two writers can change the same event without losing either edit. Tempo records the divergence, lets you choose, and keeps both copies until it&apos;s resolved.
      </p>
    </motion.div>
  );
}
