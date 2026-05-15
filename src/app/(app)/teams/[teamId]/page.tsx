"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Mail,
  UserPlus,
  Loader2,
  Crown,
  Shield,
  Eye,
  User as UserIcon,
  Trash2,
  FolderOpen,
  X,
  Copy,
  Check,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useTeamsStore } from "@/store/teams";
import {
  getUserProjects,
  assignProjectToTeam,
  type TeamRole,
  type FirestoreProject,
} from "@/lib/firebase/firestore";

const ease = [0.22, 0.61, 0.36, 1] as const;

const roleConfig: Record<
  TeamRole,
  {
    label: string;
    icon: typeof Crown;
    color: string;
    solidBg: string;
    accent: string;
  }
> = {
  owner: {
    label: "Owner",
    icon: Crown,
    color: "text-amber",
    solidBg: "bg-amber",
    accent: "border-l-amber",
  },
  admin: {
    label: "Admin",
    icon: Shield,
    color: "text-violet",
    solidBg: "bg-violet",
    accent: "border-l-violet",
  },
  member: {
    label: "Member",
    icon: UserIcon,
    color: "text-cyan",
    solidBg: "bg-cyan",
    accent: "border-l-cyan",
  },
  viewer: {
    label: "Viewer",
    icon: Eye,
    color: "text-muted",
    solidBg: "bg-muted",
    accent: "border-l-muted",
  },
};

export default function TeamDetailPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = use(params);
  const { user } = useAuth();
  const router = useRouter();
  const {
    activeTeam,
    members,
    invites,
    teamProjects,
    loading,
    loadTeam,
    inviteMember,
    revokeInvite,
    changeRole,
    removeMember,
    deleteTeam,
  } = useTeamsStore();

  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<TeamRole>("member");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showAddProject, setShowAddProject] = useState(false);
  const [myProjects, setMyProjects] = useState<FirestoreProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);

  useEffect(() => {
    loadTeam(teamId);
  }, [teamId, loadTeam]);

  const currentMember = members.find((m) => m.userId === user?.uid);
  const canManage =
    currentMember?.role === "owner" || currentMember?.role === "admin";
  const isOwner = currentMember?.role === "owner";
  const myRole = currentMember?.role ?? "viewer";

  const handleInvite = async () => {
    if (!user || !activeTeam || !inviteEmail.trim()) return;
    if (!/^\S+@\S+\.\S+$/.test(inviteEmail.trim())) {
      setError("Enter a valid email");
      return;
    }
    setInviting(true);
    setError(null);
    try {
      await inviteMember({
        teamId,
        teamName: activeTeam.name,
        inviterId: user.uid,
        inviterName: user.displayName || user.email || "A teammate",
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      setInviteEmail("");
      setShowInvite(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send invite");
    } finally {
      setInviting(false);
    }
  };

  const openAddProject = async () => {
    if (!user) return;
    setShowAddProject(true);
    setLoadingProjects(true);
    try {
      const all = await getUserProjects(user.uid);
      setMyProjects(all.filter((p) => p.teamId !== teamId));
    } finally {
      setLoadingProjects(false);
    }
  };

  const handleAssignProject = async (projectId: string) => {
    setAssigning(projectId);
    try {
      await assignProjectToTeam(projectId, teamId);
      await loadTeam(teamId);
      setShowAddProject(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign project");
    } finally {
      setAssigning(null);
    }
  };

  const copyInviteLink = (inviteId: string) => {
    const url = `${window.location.origin}/invites/${inviteId}`;
    navigator.clipboard.writeText(url);
    setCopied(inviteId);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleDeleteTeam = async () => {
    if (!activeTeam) return;
    if (
      !confirm(
        `Delete team "${activeTeam.name}"? This removes all members and cannot be undone.`
      )
    )
      return;
    await deleteTeam(teamId);
    router.push("/teams");
  };

  if (loading && !activeTeam) {
    return (
      <div className="relative min-h-screen">
        <div className="relative flex items-center justify-center min-h-screen text-muted gap-2">
          <Loader2 size={18} className="animate-spin text-violet" />
          <span className="text-xs uppercase tracking-[0.2em]">
            Loading team
          </span>
        </div>
      </div>
    );
  }

  if (!activeTeam) {
    return (
      <div className="relative min-h-screen">
        <div className="relative flex flex-col items-center justify-center min-h-screen gap-4">
          <div className="text-foreground font-display text-4xl">
            Team not found.
          </div>
          <Link
            href="/teams"
            className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.2em] text-violet hover:underline"
          >
            <ArrowLeft size={12} /> Back to teams
          </Link>
        </div>
      </div>
    );
  }

  const myRoleCfg = roleConfig[myRole];

  return (
    <div className="relative min-h-screen overflow-y-auto">
      <div className="relative max-w-6xl mx-auto px-8 py-12">
        {/* Back link */}
        <motion.div
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, ease }}
        >
          <Link
            href="/teams"
            className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-muted hover:text-violet mb-8 transition-colors"
          >
            <ArrowLeft size={12} /> Teams index
          </Link>
        </motion.div>

        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease }}
          className="mb-10"
        >
          
          <div className="flex items-start gap-6">
            <div className="w-20 h-20 bg-black dark:bg-white text-white dark:text-black font-display text-4xl flex items-center justify-center shrink-0 border border-border">
              {activeTeam.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="font-display text-[clamp(2.5rem,6vw,4rem)] leading-[0.95] text-foreground tracking-tight">
                {activeTeam.name}
                <span className="text-violet">.</span>
              </h1>
              {activeTeam.description && (
                <p className="text-sm text-muted mt-3 max-w-xl leading-relaxed">
                  {activeTeam.description}
                </p>
              )}
              <div className="mt-4 flex items-center gap-2">
                <span
                  className={`text-[9px] font-bold uppercase tracking-[0.15em] text-white ${myRoleCfg.solidBg} px-2 py-0.5`}
                >
                  You · {myRoleCfg.label}
                </span>
                
              </div>
            </div>
            {canManage && (
              <button
                onClick={() => setShowInvite(true)}
                className="flex items-center gap-2 px-5 py-3 bg-violet text-white hover:bg-violet/90 transition-colors text-[11px] font-bold uppercase tracking-[0.15em] shrink-0"
              >
                <UserPlus size={14} />
                Invite
              </button>
            )}
          </div>
        </motion.div>
        {/* Members */}
        <section className="mb-14">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-baseline gap-3">
              <h2 className="font-display text-2xl text-foreground">
                Members
              </h2>
              <span className="text-[10px] uppercase tracking-[0.2em] text-muted">
                ({members.length})
              </span>
            </div>
          </div>
          <div className="space-y-0">
            {members.map((m, idx) => {
              const cfg = roleConfig[m.role];
              const RoleIcon = cfg.icon;
              const isSelf = m.userId === user?.uid;
              return (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, ease, delay: idx * 0.04 }}
                  className={`group flex items-center gap-4 pl-5 pr-4 py-4 bg-surface border border-border border-l-4 ${cfg.accent} -mt-px transition-colors duration-150`}
                >
                  <div className="w-10 h-10 bg-black dark:bg-white text-white dark:text-black flex items-center justify-center text-sm font-display shrink-0 border border-border">
                    {(m.displayName || m.email).charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-foreground truncate font-medium">
                        {m.displayName || m.email}
                      </span>
                      {isSelf && (
                        <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-white bg-violet px-1.5 py-px">
                          You
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted truncate mt-0.5">
                      {m.email}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {canManage && !isSelf && m.role !== "owner" ? (
                      <select
                        value={m.role}
                        onChange={(e) =>
                          changeRole(
                            teamId,
                            m.userId,
                            e.target.value as TeamRole
                          )
                        }
                        className="text-[10px] uppercase tracking-[0.15em] bg-background border border-border px-2 py-1.5 text-foreground focus:border-violet focus:outline-none"
                      >
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    ) : (
                      <span
                        className={`flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.15em] text-white ${cfg.solidBg} px-2 py-1`}
                      >
                        <RoleIcon size={10} />
                        {cfg.label}
                      </span>
                    )}
                    {canManage && !isSelf && m.role !== "owner" && (
                      <button
                        onClick={() => {
                          if (
                            confirm(`Remove ${m.displayName || m.email}?`)
                          )
                            removeMember(teamId, m.userId);
                        }}
                        className="text-muted hover:text-rose transition-colors opacity-0 group-hover:opacity-100"
                        title="Remove member"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </section>

        {/* Pending invites */}
        {canManage && invites.length > 0 && (
          <section className="mb-14">
            <div className="flex items-baseline gap-3 mb-5">
              <h2 className="font-display text-2xl text-foreground">
                Pending invites
              </h2>
              <span className="text-[10px] uppercase tracking-[0.2em] text-muted">
                ({invites.length})
              </span>
            </div>
            <div className="space-y-0">
              {invites.map((inv, idx) => (
                <motion.div
                  key={inv.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, ease, delay: idx * 0.04 }}
                  className="flex items-center gap-4 pl-5 pr-4 py-4 bg-amber/[0.04] backdrop-blur-sm border border-amber/20 border-l-4 border-l-amber -mt-px transition-colors duration-150"
                >
                  <div className="w-10 h-10 border border-amber/40 flex items-center justify-center shrink-0">
                    <Mail size={14} className="text-amber" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-foreground truncate font-medium">
                      {inv.email}
                    </div>
                    <div className="text-[10px] uppercase tracking-[0.15em] text-muted mt-0.5">
                      {roleConfig[inv.role].label} · Awaiting acceptance
                    </div>
                  </div>
                  <button
                    onClick={() => copyInviteLink(inv.id)}
                    className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] text-muted hover:text-violet transition-colors px-2 py-1 border border-border"
                  >
                    {copied === inv.id ? (
                      <>
                        <Check size={11} /> Copied
                      </>
                    ) : (
                      <>
                        <Copy size={11} /> Copy link
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => revokeInvite(inv.id)}
                    className="text-muted hover:text-rose transition-colors"
                    title="Revoke invite"
                  >
                    <X size={14} />
                  </button>
                </motion.div>
              ))}
            </div>
          </section>
        )}

        {/* Team projects */}
        <section className="mb-14">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-baseline gap-3">
              <span className="text-[10px] uppercase tracking-[0.25em] text-muted">
                § {canManage && invites.length > 0 ? "03" : "02"}
              </span>
              <h2 className="font-display text-2xl text-foreground">
                Shared projects
              </h2>
              <span className="text-[10px] uppercase tracking-[0.2em] text-muted">
                ({teamProjects.length})
              </span>
            </div>
            {canManage && (
              <button
                onClick={openAddProject}
                className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] text-violet hover:underline"
              >
                <FolderOpen size={11} /> Add project
              </button>
            )}
          </div>
          {teamProjects.length === 0 ? (
            <div className="border border-dashed border-border py-14 text-center bg-white/30 dark:bg-surface/30 backdrop-blur-sm">
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted mb-2">
                Empty shelf
              </div>
              <div className="font-display text-xl text-foreground mb-1">
                No shared projects yet.
              </div>
              <div className="text-xs text-muted">
                Assign a project to this team to collaborate.
              </div>
            </div>
          ) : (
            <div className="space-y-0">
              {teamProjects.map((p, idx) => (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, ease, delay: idx * 0.04 }}
                >
                  <Link
                    href={`/project/${p.id}`}
                    className="flex items-center gap-4 pl-5 pr-4 py-4 bg-surface border border-border border-l-4 border-l-violet -mt-px hover:translate-x-1 hover:border-violet transition-all"
                  >
                    <div className="w-10 h-10 border border-border flex items-center justify-center shrink-0">
                      <FolderOpen size={14} className="text-violet" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-foreground truncate font-medium">
                        {p.name}
                      </div>
                      <div className="text-[10px] uppercase tracking-[0.15em] text-muted mt-0.5">
                        {p.docCount} docs · {p.mode} mode
                      </div>
                    </div>
                    <span className="text-[10px] uppercase tracking-[0.2em] text-muted">
                      Open →
                    </span>
                  </Link>
                </motion.div>
              ))}
            </div>
          )}
        </section>

        {/* Danger zone */}
        {isOwner && (
          <section className="pt-8 border-t border-border">
            <div className="flex items-baseline gap-3 mb-4">
              <span className="text-[10px] uppercase tracking-[0.25em] text-rose">
                ⚠ Danger
              </span>
              <h2 className="font-display text-xl text-foreground">
                Destructive actions
              </h2>
            </div>
            <div className="border border-rose/30 bg-rose/[0.04] p-5 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm text-foreground font-medium">
                  Delete this team
                </div>
                <div className="text-[11px] text-muted mt-1">
                  All members, invites, and project assignments will be removed.
                  Projects themselves stay with their owners.
                </div>
              </div>
              <button
                onClick={handleDeleteTeam}
                className="flex items-center gap-2 px-4 py-2.5 bg-rose text-white hover:bg-rose/90 transition-colors text-[11px] font-bold uppercase tracking-[0.15em] shrink-0"
              >
                <Trash2 size={12} />
                Delete team
              </button>
            </div>
          </section>
        )}
      </div>

      {/* Add project modal */}
      {showAddProject && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !assigning && setShowAddProject(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.22, ease }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white dark:bg-surface border border-border shadow-2xl relative"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div>
                <div className="text-[9px] uppercase tracking-[0.25em] text-muted mb-0.5">
                  Share
                </div>
                <h2 className="font-display text-lg text-foreground">
                  Project with team
                </h2>
              </div>
              <button
                onClick={() => !assigning && setShowAddProject(false)}
                className="text-muted hover:text-foreground"
              >
                <X size={16} />
              </button>
            </div>
            <div className="max-h-[400px] overflow-y-auto">
              {loadingProjects ? (
                <div className="flex justify-center py-12 text-muted gap-2 text-[11px] uppercase tracking-[0.2em]">
                  <Loader2 size={13} className="animate-spin text-violet" />
                  Loading projects
                </div>
              ) : myProjects.length === 0 ? (
                <div className="py-12 px-6 text-center">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-muted mb-1">
                    Empty
                  </div>
                  <div className="text-sm text-foreground">
                    No available projects.
                  </div>
                  <div className="text-[11px] text-muted mt-1">
                    Create a project from the dashboard first.
                  </div>
                </div>
              ) : (
                <div>
                  {myProjects.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => handleAssignProject(p.id)}
                      disabled={!!assigning}
                      className="w-full flex items-center gap-3 px-5 py-4 border-b border-border border-l-4 border-l-transparent hover:border-l-violet hover:bg-violet/5 disabled:opacity-50 transition-all text-left"
                    >
                      <FolderOpen size={14} className="text-violet shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-foreground truncate font-medium">
                          {p.name}
                        </div>
                        <div className="text-[10px] uppercase tracking-[0.15em] text-muted mt-0.5">
                          {p.docCount} docs · {p.mode} mode
                        </div>
                      </div>
                      {assigning === p.id && (
                        <Loader2
                          size={12}
                          className="animate-spin text-violet"
                        />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}

      {/* Invite modal */}
      {showInvite && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !inviting && setShowInvite(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.22, ease }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white dark:bg-surface border border-border shadow-2xl relative"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div>
                <div className="text-[9px] uppercase tracking-[0.25em] text-muted mb-0.5">
                  Invite
                </div>
                <h2 className="font-display text-lg text-foreground">
                  {activeTeam.name}
                </h2>
              </div>
              <button
                onClick={() => !inviting && setShowInvite(false)}
                className="text-muted hover:text-foreground"
              >
                <X size={16} />
              </button>
            </div>
            <div className="px-6 py-5 space-y-5">
              <div>
                <label className="block text-[9px] font-bold uppercase tracking-[0.2em] text-muted mb-2">
                  Email address
                </label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="teammate@example.com"
                  className="w-full px-3 py-3 bg-background border border-border focus:border-violet focus:outline-none text-sm text-foreground placeholder:text-muted font-mono"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-[9px] font-bold uppercase tracking-[0.2em] text-muted mb-2">
                  Role
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as TeamRole)}
                  className="w-full px-3 py-3 bg-background border border-border focus:border-violet focus:outline-none text-sm text-foreground"
                >
                  <option value="admin">Admin — can manage team</option>
                  <option value="member">Member — can edit projects</option>
                  <option value="viewer">Viewer — read only</option>
                </select>
              </div>
              {error && (
                <div className="text-[11px] text-rose border border-rose/30 bg-rose/5 px-3 py-2 uppercase tracking-[0.1em]">
                  {error}
                </div>
              )}
              <p className="text-[10px] uppercase tracking-[0.15em] text-muted leading-relaxed">
                An invite link will be created. The recipient must sign in with
                this email to accept.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-background/50">
              <button
                onClick={() => setShowInvite(false)}
                disabled={inviting}
                className="px-4 py-2.5 text-[11px] uppercase tracking-[0.15em] text-muted hover:text-foreground disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleInvite}
                disabled={inviting || !inviteEmail.trim()}
                className="flex items-center gap-2 px-5 py-2.5 bg-violet text-white hover:bg-violet/90 disabled:opacity-50 transition-colors text-[11px] font-bold uppercase tracking-[0.15em]"
              >
                {inviting && <Loader2 size={12} className="animate-spin" />}
                Send invite
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
