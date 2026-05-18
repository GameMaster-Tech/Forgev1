"use client";

/**
 * SharingDialog — modal for inviting users, picking roles, and managing
 * the public link on a resource.
 *
 * Headless w.r.t. persistence: uses the local sharing store. A future
 * Firestore-backed adapter is a one-file swap.
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { X, Users, Link2, Copy, Trash2, Loader2, ChevronDown } from "lucide-react";
import {
  addGrant,
  getSharingState,
  mintPublicLink,
  revokeGrant,
  revokePublicLink,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  subscribeSharing,
  type ShareGrant,
  type ShareRole,
  type SharingState,
  type ShareableResource,
} from "@/lib/sharing";
import { useAuth } from "@/context/AuthContext";

const ease = [0.22, 0.61, 0.36, 1] as const;
const ROLES: ShareRole[] = ["editor", "commenter", "viewer", "free-busy"];

interface Props {
  resource: ShareableResource;
  onClose: () => void;
}

export function SharingDialog({ resource, onClose }: Props) {
  const { user } = useAuth();
  const [state, setState] = useState<SharingState>(() => getSharingState(resource.kind, resource.id));
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ShareRole>("viewer");
  const [busy, setBusy] = useState(false);
  const [linkTtl, setLinkTtl] = useState<"never" | "24h" | "7d" | "30d">("never");

  useEffect(() => {
    return subscribeSharing(() => setState(getSharingState(resource.kind, resource.id)));
  }, [resource.kind, resource.id]);

  // ESC to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleInvite() {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) return;
    setBusy(true);
    addGrant(resource.kind, resource.id, {
      principal: { kind: "user", id: trimmed, displayName: trimmed.split("@")[0] },
      role,
      grantedBy: user?.uid ?? "self",
    });
    setEmail("");
    setBusy(false);
  }

  function handleRevoke(g: ShareGrant) {
    revokeGrant(resource.kind, resource.id, g.id);
  }

  function handleMintLink() {
    if (resource.kind !== "calendar" && resource.kind !== "event") return;
    const ttlHours = linkTtl === "24h" ? 24 : linkTtl === "7d" ? 168 : linkTtl === "30d" ? 720 : undefined;
    mintPublicLink(resource.kind, resource.id, "viewer", ttlHours);
  }

  function copyLink() {
    if (!state.publicLink) return;
    const url = `${typeof window !== "undefined" ? window.location.origin : ""}/share/${state.publicLink.token}`;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(url);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-foreground/30 z-50 flex items-end sm:items-center sm:justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Share ${resource.label}`}
    >
      <motion.div
        initial={{ y: 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 12, opacity: 0 }}
        transition={{ duration: 0.22, ease }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-background border border-border shadow-[0_30px_80px_-20px_rgba(0,0,0,0.4)]"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users size={12} className="text-violet" strokeWidth={2} />
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted font-semibold">Share</span>
            <span className="text-[10px] text-muted">·</span>
            <span className="text-[12px] text-foreground font-medium truncate max-w-[280px]">{resource.label}</span>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center text-muted hover:text-foreground" aria-label="Close">
            <X size={14} />
          </button>
        </div>

        {/* Invite */}
        <div className="px-5 py-5 border-b border-border space-y-3">
          <label className="block">
            <span className="block text-[10px] uppercase tracking-[0.15em] text-muted font-medium mb-2">Invite by email</span>
            <div className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleInvite(); }}
                placeholder="someone@example.com"
                className="flex-1 border border-border bg-background px-3 py-2 text-[13px] focus:border-violet outline-none"
                autoFocus
              />
              <RolePicker value={role} onChange={setRole} />
              <button
                onClick={handleInvite}
                disabled={busy || !email.trim() || !email.includes("@")}
                className="bg-violet text-white text-[11px] font-semibold uppercase tracking-[0.12em] px-4 hover:bg-violet/90 disabled:opacity-50 transition-colors inline-flex items-center gap-1"
              >
                {busy ? <Loader2 size={11} className="animate-spin" /> : "Invite"}
              </button>
            </div>
            <p className="text-[11px] text-muted mt-2 leading-relaxed">{ROLE_DESCRIPTIONS[role]}</p>
          </label>
        </div>

        {/* Existing grants */}
        <div className="px-5 py-4 border-b border-border">
          <p className="text-[10px] uppercase tracking-[0.15em] text-muted font-semibold mb-3">
            People with access · {state.grants.length}
          </p>
          {state.grants.length === 0 ? (
            <p className="text-[12.5px] text-muted leading-relaxed">Just you. Invite someone above.</p>
          ) : (
            <ul className="divide-y divide-border border-y border-border">
              {state.grants.map((g) => (
                <li key={g.id} className="px-2 py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] text-foreground font-medium truncate">{g.principal.displayName ?? g.principal.id}</div>
                    <div className="text-[10px] uppercase tracking-[0.12em] text-muted">
                      {ROLE_LABELS[g.role]} · invited {new Date(g.grantedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      {g.expiresAt && <> · expires {new Date(g.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</>}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRevoke(g)}
                    className="text-muted hover:text-rose w-7 h-7 flex items-center justify-center border border-border hover:border-rose transition-colors"
                    aria-label={`Revoke access for ${g.principal.id}`}
                    title="Revoke"
                  >
                    <Trash2 size={11} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Public link */}
        {(resource.kind === "calendar" || resource.kind === "event") && (
          <div className="px-5 py-4 border-b border-border">
            <div className="flex items-center justify-between gap-3 mb-3">
              <span className="text-[10px] uppercase tracking-[0.15em] text-muted font-semibold flex items-center gap-1">
                <Link2 size={11} /> Public link
              </span>
              {state.publicLink && (
                <button onClick={() => revokePublicLink(resource.kind, resource.id)} className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted hover:text-rose">
                  Revoke
                </button>
              )}
            </div>
            {state.publicLink ? (
              <div className="flex items-center gap-2 border border-border bg-surface px-3 py-2">
                <span className="text-[11px] text-foreground truncate flex-1 font-mono">{state.publicLink.token.slice(0, 16)}…</span>
                <button onClick={copyLink} className="border border-border w-7 h-7 flex items-center justify-center text-muted hover:text-violet hover:border-violet transition-colors" aria-label="Copy">
                  <Copy size={11} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <select value={linkTtl} onChange={(e) => setLinkTtl(e.target.value as "never" | "24h" | "7d" | "30d")} className="border border-border bg-background px-2 py-1.5 text-[12px]">
                  <option value="never">No expiry</option>
                  <option value="24h">Expires in 24h</option>
                  <option value="7d">Expires in 7 days</option>
                  <option value="30d">Expires in 30 days</option>
                </select>
                <button onClick={handleMintLink} className="border border-border text-[11px] uppercase tracking-[0.12em] font-semibold px-3 py-1.5 text-foreground hover:border-violet hover:text-violet transition-colors">
                  Generate viewer link
                </button>
              </div>
            )}
            <p className="text-[11px] text-muted leading-relaxed mt-2">
              Anyone with the link can view as a non-authenticated viewer. Revoke any time.
            </p>
          </div>
        )}

        <div className="px-5 py-3 flex items-center justify-end">
          <button onClick={onClose} className="text-[11px] uppercase tracking-[0.12em] font-semibold text-muted hover:text-foreground px-3 py-2">Done</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function RolePicker({ value, onChange }: { value: ShareRole; onChange: (r: ShareRole) => void }) {
  return (
    <div className="relative inline-flex">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ShareRole)}
        className="appearance-none border border-border bg-surface px-3 pr-8 py-2 text-[11px] uppercase tracking-[0.12em] font-semibold text-foreground focus:border-violet outline-none"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
        ))}
      </select>
      <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
    </div>
  );
}
