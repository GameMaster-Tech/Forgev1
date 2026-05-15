"use client";

/**
 * Teams — workspace index with a right-rail companion.
 *
 * Two-column layout (8/4 on desktop, stacked on mobile):
 *   • Main: header + teams list (or empty state).
 *   • Rail: roles legend + manifesto card explaining why teams.
 *
 * Same pattern as the Projects page so the workspace surface reads
 * as one cohesive system, not a folder of disparate pages.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Plus,
  ArrowRight,
  Loader2,
  X,
  Crown,
  Shield,
  User as UserIcon,
  Eye,
  Sparkles,
  Mail,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useTeamsStore } from "@/store/teams";

const ease = [0.22, 0.61, 0.36, 1] as const;

const ROLE_META = [
  { key: "owner",  label: "Owner",  icon: Crown,     accent: "text-amber",  blurb: "Full control. Can delete the team and transfer ownership." },
  { key: "admin",  label: "Admin",  icon: Shield,    accent: "text-violet", blurb: "Manage members, invites, and shared projects." },
  { key: "member", label: "Member", icon: UserIcon,  accent: "text-cyan",   blurb: "Edit shared projects. Add sources. Run research." },
  { key: "viewer", label: "Viewer", icon: Eye,       accent: "text-muted",  blurb: "Read-only access to everything the team owns." },
] as const;

export default function TeamsPage() {
  const { user } = useAuth();
  const { teams, loading, fetchTeams, createTeam } = useTeamsStore();

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.uid) fetchTeams(user.uid);
  }, [user?.uid, fetchTeams]);

  const handleCreate = async () => {
    if (!user || !name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await createTeam(
        {
          uid: user.uid,
          displayName: user.displayName || user.email || "User",
          email: user.email || "",
        },
        { name: name.trim(), description: desc.trim() }
      );
      setName("");
      setDesc("");
      setShowCreate(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create team");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-full bg-background">
      {/* ── Header ─────────────────────────────────────────────── */}
      <motion.header
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease }}
        className="border-b border-border px-6 sm:px-10 pt-10 pb-6"
      >
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-2">
              Teams
            </p>
            <h1 className="font-display font-extrabold text-3xl sm:text-4xl text-foreground tracking-[-0.025em] leading-[1.05]">
              Your collectives.
            </h1>
            <p className="text-[13px] text-muted mt-2 max-w-xl leading-relaxed">
              Share projects, sources, and verified citations across people. Roles control who can edit, invite, and delete.
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 bg-violet text-white hover:bg-violet/90 text-[11px] font-semibold uppercase tracking-[0.12em] px-5 py-2.5 transition-colors duration-150 shrink-0"
          >
            <Plus size={12} strokeWidth={2.25} />
            New team
          </button>
        </div>
      </motion.header>

      {/* ── Body — two-column ────────────────────────────────── */}
      <div className="grid grid-cols-12 gap-x-0">
        {/* Main column */}
        <div className="col-span-12 lg:col-span-8 px-6 sm:px-10 pt-8 pb-16 lg:border-r lg:border-border">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, ease, delay: 0.1 }}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium">
                Your teams
              </span>
              {teams.length > 0 && (
                <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums">
                  {teams.length} total
                </span>
              )}
            </div>

            {loading ? (
              <div className="flex items-center gap-3 py-20 justify-center text-sm text-muted border border-border bg-surface">
                <Loader2 size={16} className="animate-spin text-violet" />
                Loading teams…
              </div>
            ) : teams.length === 0 ? (
              <EmptyState onCreate={() => setShowCreate(true)} />
            ) : (
              <ul className="divide-y divide-border border border-border bg-surface">
                {teams.map((team, i) => {
                  const isOwner = team.ownerId === user?.uid;
                  return (
                    <motion.li
                      key={team.id}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.3, ease, delay: 0.12 + i * 0.04 }}
                    >
                      <Link
                        href={`/teams/${team.id}`}
                        className="group relative flex items-center gap-5 px-5 py-4 hover:bg-violet/[0.06] transition-colors duration-150"
                      >
                        <span
                          aria-hidden
                          className="absolute left-0 top-3 bottom-3 w-[2px] bg-border group-hover:bg-violet transition-colors duration-150"
                        />

                        <div className="w-10 h-10 bg-foreground text-background flex items-center justify-center font-display font-bold text-base shrink-0">
                          {team.name.charAt(0).toUpperCase()}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2.5">
                            <h3 className="font-display font-bold text-[16px] text-foreground truncate group-hover:text-violet transition-colors tracking-[-0.01em]">
                              {team.name}
                            </h3>
                            {isOwner && (
                              <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.15em] font-semibold text-amber">
                                <Crown size={9} strokeWidth={2.25} />
                                Owner
                              </span>
                            )}
                          </div>
                          <p className="text-[12px] text-muted truncate mt-0.5">
                            {team.description || "No description"}
                          </p>
                        </div>

                        <ArrowRight
                          size={14}
                          className="text-muted group-hover:text-violet transition-colors shrink-0"
                        />
                      </Link>
                    </motion.li>
                  );
                })}
              </ul>
            )}
          </motion.div>
        </div>

        {/* Right rail companion */}
        <aside className="col-span-12 lg:col-span-4 px-6 sm:px-10 pt-8 pb-16 space-y-6">
          <RolesLegend />
          <ManifestoCard />
        </aside>
      </div>

      {/* ── Create modal ──────────────────────────────────── */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !creating && setShowCreate(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.22, ease }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-surface border border-border shadow-[0_24px_56px_-20px_rgba(0,0,0,0.35)] overflow-hidden"
          >
            <div className="px-6 pt-5 pb-4 border-b border-border flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-1">
                  New collective
                </p>
                <h2 className="font-display font-bold text-[20px] text-foreground tracking-[-0.018em] leading-tight">
                  Create a team.
                </h2>
              </div>
              <button
                onClick={() => !creating && setShowCreate(false)}
                className="text-muted hover:text-foreground transition-colors p-1.5"
                aria-label="Close"
              >
                <X size={15} strokeWidth={1.75} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              <div>
                <label className="block text-[10px] font-medium uppercase tracking-[0.18em] text-muted mb-2">
                  Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Neuroscience Lab"
                  className="w-full px-3.5 py-3 bg-background border border-border focus:border-violet focus:outline-none text-sm text-foreground placeholder:text-muted transition-colors"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium uppercase tracking-[0.18em] text-muted mb-2">
                  Description
                </label>
                <textarea
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  placeholder="What does this team work on?"
                  rows={3}
                  className="w-full px-3.5 py-3 bg-background border border-border focus:border-violet focus:outline-none text-sm text-foreground placeholder:text-muted resize-none transition-colors leading-relaxed"
                />
              </div>
              {error && (
                <div className="text-[11px] text-rose border-l-2 border-rose bg-rose/5 px-3 py-2 font-medium">
                  {error}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border">
              <button
                onClick={() => setShowCreate(false)}
                disabled={creating}
                className="px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted hover:text-foreground transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !name.trim()}
                className="flex items-center gap-2 px-5 py-2.5 bg-violet text-white hover:bg-violet/90 disabled:opacity-50 transition-colors text-[11px] font-semibold uppercase tracking-[0.12em]"
              >
                {creating && <Loader2 size={12} className="animate-spin" />}
                Create team
                <ArrowRight size={12} strokeWidth={2} />
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

/* ── Right-rail: roles legend ───────────────────────────────── */
function RolesLegend() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.1, ease }}
    >
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
        Roles
      </p>
      <div className="border border-border bg-surface divide-y divide-border">
        {ROLE_META.map((r) => {
          const Icon = r.icon;
          return (
            <div key={r.key} className="flex items-start gap-3.5 px-4 py-3.5">
              <div className="mt-0.5 w-6 h-6 border border-border bg-background flex items-center justify-center shrink-0">
                <Icon size={12} strokeWidth={1.75} className={r.accent} />
              </div>
              <div className="min-w-0 flex-1">
                <div className={`text-[10px] uppercase tracking-[0.15em] font-semibold ${r.accent}`}>
                  {r.label}
                </div>
                <p className="text-[12px] text-muted leading-relaxed mt-0.5">
                  {r.blurb}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

/* ── Right-rail: manifesto card ────────────────────────────── */
function ManifestoCard() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.18, ease }}
      className="border border-border bg-foreground text-background p-5 relative overflow-hidden"
    >
      <span
        aria-hidden
        className="absolute top-0 left-0 w-[2px] h-full bg-violet"
      />
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={12} strokeWidth={2} className="text-violet" />
        <span className="text-[10px] uppercase tracking-[0.18em] text-background/60 font-medium">
          Why teams?
        </span>
      </div>
      <h3 className="font-display font-bold text-[18px] tracking-[-0.018em] leading-[1.2] mb-3">
        Research <span className="text-violet">survives the person</span>.
      </h3>
      <p className="text-[13px] text-background/70 leading-relaxed mb-4">
        Teams share projects, sources, and verified citations. When someone leaves, their work stays. When someone joins, the project memory comes with them.
      </p>
      <div className="flex items-center gap-1.5 text-[11px] text-background/55 font-medium">
        <Mail size={11} strokeWidth={1.75} />
        Invite by email
      </div>
    </motion.div>
  );
}

/* ── Empty state ────────────────────────────────────────────── */
function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="border border-border bg-surface px-6 py-14">
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
        No teams yet
      </p>
      <h2 className="font-display font-bold text-foreground text-2xl sm:text-3xl tracking-[-0.022em] leading-[1.1] mb-3">
        Assemble your <span className="text-violet">research crew</span>.
      </h2>
      <p className="text-[13px] text-muted leading-relaxed mb-6 max-w-md">
        Teams share projects, sources, and verified citations. Owner, admin, member, viewer — control who can edit, invite, and delete.
      </p>
      <button
        onClick={onCreate}
        className="inline-flex items-center gap-2 bg-violet text-white hover:bg-violet/90 text-[11px] font-semibold uppercase tracking-[0.12em] px-5 py-2.5 transition-colors duration-150"
      >
        <Plus size={12} strokeWidth={2.25} />
        Create first team
        <ArrowRight size={12} strokeWidth={2} />
      </button>
    </div>
  );
}
