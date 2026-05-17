"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
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
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const logout = useCallback(async () => {
    if (readE2EStub()) {
      (window as unknown as Record<string, unknown>).__E2E_AUTH = undefined;
      setUser(null);
      return;
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
