"use client";

/**
 * useEchoNotices — live subscription to the user's ACTIVE Echo notices.
 *
 * Reads `users/{uid}/echo_notices` filtered to active records
 * (dismissedAt == null AND (snoozedUntil == null OR snoozedUntil < now)),
 * ordered by severity then createdAt desc.
 *
 * The Firestore query can't combine all three conditions cheaply, so
 * we filter dismissedAt at the server (composite index) and apply the
 * snoozedUntil filter on the client. With MAX 50 docs that's free.
 *
 * Also exposes mutation helpers — `snooze`, `dismiss`, `markDone`,
 * `markSeen` — that update the row directly. Firestore rules allow
 * the owner to update any of these fields on their own notices.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  limit as fbLimit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import type { EchoNotice } from "@/lib/echo/types";

const MAX_NOTICES = 50;

export interface UseEchoNoticesApi {
  active: EchoNotice[];
  unseenCount: number;
  loading: boolean;
  /** Snooze for `hours` (default 24). */
  snooze: (id: string, hours?: number) => Promise<void>;
  /** Dismiss permanently — future scans won't re-surface the same signal. */
  dismiss: (id: string) => Promise<void>;
  /** Same as dismiss but tags `resolvedAs: "fixed"` for analytics. */
  markDone: (id: string) => Promise<void>;
  /** Mark every currently-active notice as seen. Call when the tray opens. */
  markAllSeen: () => Promise<void>;
}

export function useEchoNotices(uid: string | null): UseEchoNoticesApi {
  const [rows, setRows] = useState<EchoNotice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let unsub: Unsubscribe | null = null;
    try {
      const q = query(
        collection(db, `users/${uid}/echo_notices`),
        where("dismissedAt", "==", null),
        orderBy("createdAt", "desc"),
        fbLimit(MAX_NOTICES),
      );
      unsub = onSnapshot(
        q,
        (snap) => {
          const now = Date.now();
          const out: EchoNotice[] = [];
          for (const d of snap.docs) {
            const data = d.data() as EchoNotice;
            // Client-side snooze filter — keeps the query simple.
            if (data.snoozedUntil && data.snoozedUntil > now) continue;
            out.push({ ...data, id: d.id });
          }
          setRows(sortBySeverity(out));
          setLoading(false);
        },
        (err) => {
          console.warn("[useEchoNotices] subscription failed:", err);
          setRows([]);
          setLoading(false);
        },
      );
    } catch (err) {
      console.warn("[useEchoNotices] could not subscribe:", err);
      setLoading(false);
    }
    return () => {
      if (unsub) unsub();
    };
  }, [uid]);

  const snooze = useCallback(
    async (id: string, hours = 24) => {
      if (!uid) return;
      const ref = doc(db, `users/${uid}/echo_notices/${id}`);
      await updateDoc(ref, {
        snoozedUntil: Date.now() + hours * 3_600_000,
        resolvedAs: "snoozed",
      });
    },
    [uid],
  );

  const dismiss = useCallback(
    async (id: string) => {
      if (!uid) return;
      const ref = doc(db, `users/${uid}/echo_notices/${id}`);
      await updateDoc(ref, {
        dismissedAt: Date.now(),
        resolvedAs: "dismissed",
      });
    },
    [uid],
  );

  const markDone = useCallback(
    async (id: string) => {
      if (!uid) return;
      const ref = doc(db, `users/${uid}/echo_notices/${id}`);
      await updateDoc(ref, {
        dismissedAt: Date.now(),
        resolvedAs: "fixed",
      });
    },
    [uid],
  );

  const markAllSeen = useCallback(async () => {
    if (!uid) return;
    const unseen = rows.filter((r) => !r.seen);
    if (unseen.length === 0) return;
    const batch = writeBatch(db);
    for (const r of unseen) {
      batch.update(doc(db, `users/${uid}/echo_notices/${r.id}`), { seen: true });
    }
    await batch.commit().catch((err) => {
      console.warn("[useEchoNotices] markAllSeen failed:", err);
    });
  }, [uid, rows]);

  const unseenCount = useMemo(
    () => rows.filter((r) => !r.seen).length,
    [rows],
  );

  return useMemo(
    () => ({ active: rows, unseenCount, loading, snooze, dismiss, markDone, markAllSeen }),
    [rows, unseenCount, loading, snooze, dismiss, markDone, markAllSeen],
  );
}

/** High first, then medium, then low; createdAt desc within each tier. */
function sortBySeverity(rows: EchoNotice[]): EchoNotice[] {
  const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  return [...rows].sort((a, b) => {
    const rA = rank[a.severity] ?? 1;
    const rB = rank[b.severity] ?? 1;
    if (rA !== rB) return rA - rB;
    return b.createdAt - a.createdAt;
  });
}
