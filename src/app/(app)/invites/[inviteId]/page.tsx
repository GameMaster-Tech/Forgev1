"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { motion } from "framer-motion";
import { Loader2, Users, Check, X, AlertCircle } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useTeamsStore } from "@/store/teams";
import type { FirestoreTeamInvite } from "@/lib/firebase/firestore";

const ease = [0.22, 0.61, 0.36, 1] as const;

export default function InvitePage({
  params,
}: {
  params: Promise<{ inviteId: string }>;
}) {
  const { inviteId } = use(params);
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { acceptInvite } = useTeamsStore();

  const [invite, setInvite] = useState<FirestoreTeamInvite | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDoc(doc(db, "teamInvites", inviteId));
        if (!snap.exists()) {
          setError("Invite not found");
        } else {
          const data = { id: snap.id, ...snap.data() } as FirestoreTeamInvite;
          if (data.status !== "pending") {
            setError(
              data.status === "accepted"
                ? "This invite has already been accepted"
                : "This invite has been revoked"
            );
          }
          setInvite(data);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load invite");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [inviteId]);

  const handleAccept = async () => {
    if (!user || !invite) return;
    if (
      invite.email.toLowerCase().trim() !==
      (user.email || "").toLowerCase().trim()
    ) {
      setError(
        `This invite is for ${invite.email}. Sign in with that email to accept.`
      );
      return;
    }
    setAccepting(true);
    try {
      const teamId = await acceptInvite(inviteId, {
        uid: user.uid,
        email: user.email || "",
        displayName: user.displayName || user.email || "User",
      });
      router.push(`/teams/${teamId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept invite");
      setAccepting(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen text-muted gap-2">
        <Loader2 size={18} className="animate-spin text-violet" />
        <span className="text-sm">Loading invite...</span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen p-6">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease }}
        className="w-full max-w-md bg-white dark:bg-surface border border-border p-8"
      >
        <div className="w-12 h-12 bg-gradient-to-br from-violet to-cyan flex items-center justify-center mb-5">
          <Users size={20} className="text-white" />
        </div>

        {error ? (
          <>
            <div className="flex items-center gap-2 text-rose mb-2">
              <AlertCircle size={16} />
              <span className="text-[10px] uppercase tracking-[0.2em]">
                Can&apos;t accept
              </span>
            </div>
            <h1 className="font-display text-2xl text-foreground mb-2">
              Invite unavailable
            </h1>
            <p className="text-sm text-muted mb-6">{error}</p>
            <button
              onClick={() => router.push("/teams")}
              className="px-4 py-2.5 bg-black dark:bg-white text-white dark:text-black text-xs font-medium hover:bg-violet dark:hover:bg-violet dark:hover:text-white transition-colors"
            >
              Go to teams
            </button>
          </>
        ) : invite ? (
          <>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted mb-1">
              Team invitation
            </div>
            <h1 className="font-display text-2xl text-foreground mb-1">
              {invite.teamName}
            </h1>
            <p className="text-sm text-muted mb-6">
              <span className="text-foreground">{invite.inviterName}</span>{" "}
              invited <span className="text-foreground">{invite.email}</span>{" "}
              to join as a{" "}
              <span className="text-violet">{invite.role}</span>.
            </p>

            {!user ? (
              <div className="space-y-3">
                <p className="text-xs text-muted">
                  Sign in with{" "}
                  <span className="text-foreground">{invite.email}</span> to
                  accept this invite.
                </p>
                <button
                  onClick={() =>
                    router.push(
                      `/auth/login?redirect=/invites/${inviteId}`
                    )
                  }
                  className="w-full px-4 py-2.5 bg-violet text-white text-xs font-medium hover:bg-violet/90 transition-colors"
                >
                  Sign in to accept
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <button
                  onClick={handleAccept}
                  disabled={accepting}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-violet text-white text-xs font-medium hover:bg-violet/90 disabled:opacity-50 transition-colors"
                >
                  {accepting ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Check size={13} />
                  )}
                  Accept invite
                </button>
                <button
                  onClick={() => router.push("/teams")}
                  disabled={accepting}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-border text-xs text-muted hover:text-foreground disabled:opacity-50 transition-colors"
                >
                  <X size={13} />
                  Decline
                </button>
              </div>
            )}
          </>
        ) : null}
      </motion.div>
    </div>
  );
}
