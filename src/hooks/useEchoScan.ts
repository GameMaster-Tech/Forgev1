"use client";

/**
 * useEchoScan — trigger an Echo scan, with auto-run on stale.
 *
 *   • On mount, reads `users/{uid}/echo_meta/state.lastScannedAt`.
 *     If unset OR older than STALE_MS (6 hours), fires a background
 *     scan automatically — once per session.
 *   • Exposes `scan({ force })` so the tray's "Re-scan now" button
 *     can force an immediate run regardless of the throttle.
 *
 * The server already enforces a 10-minute hard throttle; this hook
 * just decides whether to ATTEMPT a call.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase/config";
import type { EchoScanSummary } from "@/lib/echo/types";

const STALE_MS = 6 * 3_600_000; // 6h since last scan → auto-refresh

async function authHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) return {};
  try {
    const token = await user.getIdToken(true);
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
  }
}

export interface UseEchoScanApi {
  scanning: boolean;
  lastScannedAt: number | null;
  lastSummary: EchoScanSummary | null;
  error: string | null;
  scan: (opts?: { force?: boolean }) => Promise<void>;
}

export function useEchoScan(uid: string | null): UseEchoScanApi {
  const [scanning, setScanning] = useState(false);
  const [lastScannedAt, setLastScannedAt] = useState<number | null>(null);
  const [lastSummary, setLastSummary] = useState<EchoScanSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Guard so we don't auto-trigger more than once per session.
  const autoFiredRef = useRef(false);

  const scan = useCallback(
    async (opts: { force?: boolean } = {}) => {
      if (!uid) {
        setError("Sign in first.");
        return;
      }
      setScanning(true);
      setError(null);
      try {
        const headers = await authHeaders();
        const res = await fetch("/api/echo/scan", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ force: !!opts.force }),
        });
        if (!res.ok) {
          let detail = `Echo scan failed (${res.status})`;
          try {
            const j = (await res.json()) as { error?: string };
            if (j.error) detail = j.error;
          } catch {
            /* keep default */
          }
          throw new Error(detail);
        }
        const data = (await res.json()) as EchoScanSummary;
        setLastSummary(data);
        setLastScannedAt(data.scannedAt);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Echo scan failed.");
      } finally {
        setScanning(false);
      }
    },
    [uid],
  );

  // Auto-run on stale.
  useEffect(() => {
    if (!uid || autoFiredRef.current) return;
    autoFiredRef.current = true;
    (async () => {
      try {
        const ref = doc(db, `users/${uid}/echo_meta/state`);
        const snap = await getDoc(ref);
        const ts =
          snap.exists()
            ? (snap.data() as { lastScannedAt?: number }).lastScannedAt ?? 0
            : 0;
        setLastScannedAt(ts || null);
        if (!ts || Date.now() - ts > STALE_MS) {
          void scan();
        }
      } catch {
        // Worst case the user clicks the manual scan button.
      }
    })();
  }, [uid, scan]);

  return useMemo(
    () => ({ scanning, lastScannedAt, lastSummary, error, scan }),
    [scanning, lastScannedAt, lastSummary, error, scan],
  );
}
