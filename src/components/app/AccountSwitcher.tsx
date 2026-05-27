"use client";

/**
 * AccountSwitcher — Gmail-style multi-account dropdown.
 *
 * Anchored to the avatar in the sidebar footer. Shows:
 *
 *   ┌─────────────────────────────────────┐
 *   │  ● Tanvi Khanna                      │  <- current
 *   │     tanvi@…                          │
 *   ├─────────────────────────────────────┤
 *   │  Switch account                      │
 *   │  ◯ Rakshit Khanna · rakshit@…       │
 *   │  ◯ Forge Tester · tester@…           │
 *   │                                      │
 *   │  + Add another account               │
 *   │                                      │
 *   │  → Sign out                          │
 *   └─────────────────────────────────────┘
 *
 * Switching = sign out the current Firebase session, then sign in
 * with `login_hint=<email>`. Google honours the hint: if the
 * target email is already in the browser's Google session cookies
 * the user is dropped straight into Forge. If not, Google prompts
 * for the password — same as a normal sign-in.
 *
 * Refusing the popup or hitting Esc cancels gracefully — the
 * original session has already been signed out at that point, so
 * the user lands on /auth/login (handled by the AuthContext gate).
 */

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, LogOut, Plus, User as UserIcon, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { signInWithGoogle, signOut } from "@/lib/firebase/auth";
import {
  forgetAccount,
  listKnownAccounts,
  type KnownAccount,
} from "@/lib/auth/known-accounts";

const EASE = [0.22, 0.61, 0.36, 1] as const;

interface AccountSwitcherProps {
  /** Whether the parent (sidebar) is in expanded mode — we render
   * a different anchor footprint for collapsed vs expanded. */
  expanded: boolean;
}

export function AccountSwitcher({ expanded }: AccountSwitcherProps) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Snapshot the roster on every open so newly-added accounts show
  // up without remounting.
  const [accounts, setAccounts] = useState<KnownAccount[]>([]);

  useEffect(() => {
    if (open) setAccounts(listKnownAccounts());
  }, [open]);

  const initials = user?.displayName
    ? user.displayName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : user?.email?.[0]?.toUpperCase() ?? "U";

  const others = accounts.filter((a) => a.uid !== user?.uid);

  const switchTo = useCallback(async (account: KnownAccount) => {
    setError(null);
    setBusy(true);
    try {
      // Sign out the current session before re-issuing the popup so
      // Firebase doesn't reject with auth/email-already-in-use shapes.
      await signOut();
      await signInWithGoogle(account.email);
      setOpen(false);
    } catch (err) {
      // Most common: user closed the popup. We've already signed
      // them out, so route them to /auth/login.
      const code = (err as { code?: string }).code ?? "";
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        if (typeof window !== "undefined") window.location.href = "/auth/login";
        return;
      }
      setError(err instanceof Error ? err.message : "Couldn't switch.");
    } finally {
      setBusy(false);
    }
  }, []);

  const addAnother = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await signOut();
      await signInWithGoogle(); // no login_hint → Google chooser
      setOpen(false);
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        if (typeof window !== "undefined") window.location.href = "/auth/login";
        return;
      }
      setError(err instanceof Error ? err.message : "Couldn't add another.");
    } finally {
      setBusy(false);
    }
  }, []);

  const forget = useCallback(
    (uid: string, e: React.MouseEvent) => {
      e.stopPropagation();
      forgetAccount(uid);
      setAccounts(listKnownAccounts());
    },
    [],
  );

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={user?.displayName || user?.email || "Account"}
        className={`group relative flex items-center gap-2.5 transition-colors ${
          expanded ? "px-1 w-full" : "justify-center pt-0.5 w-full"
        }`}
      >
        <div className="w-8 h-8 bg-violet text-white flex items-center justify-center shrink-0 hover:bg-violet/90 transition-colors">
          <span className="text-[10px] font-semibold font-display tabular-nums">
            {initials}
          </span>
        </div>
        {expanded ? (
          <div className="min-w-0 flex-1 text-left">
            <div className="text-[12px] font-medium text-background truncate">
              {user?.displayName || "Account"}
            </div>
            {user?.email ? (
              <div className="text-[10px] text-background/45 truncate">
                {user.email}
              </div>
            ) : null}
          </div>
        ) : null}
      </button>

      <AnimatePresence>
        {open ? (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setOpen(false)}
              aria-hidden
            />
            <motion.div
              role="menu"
              initial={{ opacity: 0, y: 6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.98 }}
              transition={{ duration: 0.18, ease: EASE }}
              className={`absolute z-50 ${
                expanded
                  ? "left-0 right-0 bottom-full mb-2"
                  : "left-full ml-3 bottom-0"
              } w-64 bg-foreground text-background border border-white/10 shadow-[0_24px_56px_-20px_rgba(0,0,0,0.55)] overflow-hidden`}
            >
              {/* Current row */}
              {user ? (
                <div className="flex items-center gap-2.5 px-3 py-3 border-b border-white/10">
                  <div className="w-8 h-8 bg-violet flex items-center justify-center shrink-0">
                    <span className="text-[10px] font-semibold font-display tabular-nums text-white">
                      {initials}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] text-background font-medium truncate flex items-center gap-1">
                      {user.displayName || "Account"}
                      <Check size={11} strokeWidth={2.5} className="text-violet" />
                    </div>
                    {user.email ? (
                      <div className="text-[10px] text-background/55 truncate">
                        {user.email}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {/* Other known accounts */}
              {others.length > 0 ? (
                <div className="py-1 border-b border-white/10">
                  <div className="px-3 pt-1 pb-1 text-[9px] uppercase tracking-[0.18em] font-semibold text-background/45">
                    Switch account
                  </div>
                  {others.map((a) => (
                    <button
                      key={a.uid}
                      type="button"
                      onClick={() => void switchTo(a)}
                      disabled={busy}
                      className="group/row w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/[0.06] transition-colors disabled:opacity-50"
                    >
                      <div className="w-7 h-7 bg-white/[0.06] border border-white/10 flex items-center justify-center shrink-0">
                        <span className="text-[9px] font-semibold font-display tabular-nums text-background/80">
                          {(a.displayName ?? a.email)
                            .split(/[ @]/)
                            .map((n) => n[0])
                            .join("")
                            .slice(0, 2)
                            .toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] text-background truncate">
                          {a.displayName ?? "Account"}
                        </div>
                        <div className="text-[10px] text-background/55 truncate">
                          {a.email}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => forget(a.uid, e)}
                        aria-label={`Forget ${a.email}`}
                        className="opacity-0 group-hover/row:opacity-100 text-background/50 hover:text-background transition-opacity p-1"
                      >
                        <X size={11} strokeWidth={2} />
                      </button>
                    </button>
                  ))}
                </div>
              ) : null}

              {/* Add + Sign out */}
              <div className="py-1">
                <button
                  type="button"
                  onClick={() => void addAnother()}
                  disabled={busy}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/[0.06] transition-colors disabled:opacity-50"
                >
                  <div className="w-7 h-7 bg-white/[0.06] border border-white/10 flex items-center justify-center shrink-0">
                    <Plus size={12} strokeWidth={2} className="text-background/80" />
                  </div>
                  <span className="text-[12px] text-background">
                    Add another account
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void logout()}
                  disabled={busy}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/[0.06] transition-colors disabled:opacity-50"
                >
                  <div className="w-7 h-7 bg-white/[0.06] border border-white/10 flex items-center justify-center shrink-0">
                    <LogOut size={12} strokeWidth={2} className="text-background/80" />
                  </div>
                  <span className="text-[12px] text-background">Sign out</span>
                </button>
              </div>

              {error ? (
                <div className="px-3 py-2 border-t border-rose/30 bg-rose/[0.06] text-[11px] text-rose flex items-start gap-1.5">
                  <UserIcon size={11} strokeWidth={2} className="shrink-0 mt-px" />
                  {error}
                </div>
              ) : null}
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
