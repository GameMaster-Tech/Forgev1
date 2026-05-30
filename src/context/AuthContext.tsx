"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { onIdTokenChanged, signOut, type User } from "firebase/auth";
import { auth } from "@/lib/firebase/config";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  logout: async () => {},
});

interface E2EUserStub {
  uid: string;
  email: string;
  displayName: string;
}

function readE2EStub(): User | null {
  if (typeof window === "undefined") return null;
  const stub = (window as unknown as { __E2E_AUTH?: { currentUser?: E2EUserStub } }).__E2E_AUTH;
  if (!stub?.currentUser) return null;
  // Cast — the AuthContext only reads uid / email / displayName, never
  // a method, so a Partial<User> shape is sufficient for the e2e suite.
  return stub.currentUser as unknown as User;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Lazy init reads the E2E stub once at mount so we don't call setState
  // inside the effect for the stubbed path (which would trip the
  // react-hooks/set-state-in-effect rule).
  const [user, setUser] = useState<User | null>(() => readE2EStub());
  const [loading, setLoading] = useState(() => readE2EStub() == null);

  useEffect(() => {
    if (readE2EStub()) return;
    // `onIdTokenChanged` fires on sign-in, sign-out, AND every silent
    // token refresh (~hourly). Listening here — rather than the
    // sign-in-only `onAuthStateChanged` — lets us keep the server-side
    // `__session` cookie aligned with the live token, so long sessions
    // and top-level OAuth navigations don't get spuriously 401'd.
    const unsubscribe = onIdTokenChanged(auth, async (user) => {
      setUser(user);
      setLoading(false);

      // Sync the HttpOnly session cookie with the current auth state.
      // Best-effort: a failure here must never break the UI.
      try {
        if (user) {
          const token = await user.getIdToken();
          await fetch("/api/auth/session", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          });
        } else {
          await fetch("/api/auth/session", { method: "DELETE" });
        }
      } catch {
        /* offline / transient — the cookie just lags; Bearer still works */
      }

      // Remember each successful sign-in so the multi-account
      // switcher can list this account on next render. Import is
      // dynamic so the SSR pass doesn't try to touch localStorage.
      if (user?.uid && user.email) {
        try {
          const { rememberAccount } = await import("@/lib/auth/known-accounts");
          rememberAccount({
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
          });
        } catch {
          /* ignore — module-level storage failure shouldn't kill auth */
        }
      }
    });
    return unsubscribe;
  }, []);

  const logout = useCallback(async () => {
    if (readE2EStub()) {
      (window as unknown as Record<string, unknown>).__E2E_AUTH = undefined;
      setUser(null);
      return;
    }
    // Clear the server session cookie alongside the client sign-out so a
    // stale cookie can't keep authenticating server routes.
    try {
      await fetch("/api/auth/session", { method: "DELETE" });
    } catch {
      /* best effort */
    }
    await signOut(auth);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
