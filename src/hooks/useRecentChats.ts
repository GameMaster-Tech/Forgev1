"use client";

/**
 * useRecentChats — live subscription to the user's most recently
 * touched conversations, ordered by `updatedAt` descending.
 *
 * Used by the expanded sidebar to surface "Recent chats" at the
 * top so the user can jump back into any thread without going to
 * /research first.
 *
 * Live: writes from `appendMessage` bump the parent conversation's
 * `updatedAt`, so a new turn re-orders the sidebar in real time
 * (no manual refresh needed).
 */

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  limit as fbLimit,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import type { FirestoreConversation } from "@/lib/firebase/conversations";

export interface RecentChat {
  id: string;
  title: string;
  projectId: string | null;
  /** Millis epoch — derived from updatedAt for sort stability. */
  updatedAt: number;
}

export function useRecentChats(uid: string | null, max = 8): RecentChat[] {
  const [rows, setRows] = useState<RecentChat[]>([]);

  useEffect(() => {
    if (!uid) {
      // Defer the reset so we never call setState synchronously in the
      // effect body (cascading-render lint rule).
      const reset = setTimeout(() => setRows([]));
      return () => clearTimeout(reset);
    }
    let unsub: Unsubscribe | null = null;
    try {
      // Equality-only on userId so we depend solely on Firestore's automatic
      // single-field index — no composite index required (the old
      // userId + archived + orderBy(updatedAt) query silently failed when the
      // index wasn't deployed, leaving Recent chats empty). We over-fetch,
      // then filter archived + sort by recency + cap on the client.
      const q = query(
        collection(db, "conversations"),
        where("userId", "==", uid),
        fbLimit(100),
      );
      unsub = onSnapshot(
        q,
        (snap) => {
          const next: RecentChat[] = [];
          for (const d of snap.docs) {
            const data = d.data() as FirestoreConversation;
            if (data.archived === true) continue;
            const ts =
              typeof (data.updatedAt as { toMillis?: () => number })?.toMillis === "function"
                ? (data.updatedAt as { toMillis: () => number }).toMillis()
                : 0;
            next.push({
              id: d.id,
              title: (data.title ?? "Untitled chat").trim() || "Untitled chat",
              projectId: data.projectId ?? null,
              updatedAt: ts,
            });
          }
          next.sort((a, b) => b.updatedAt - a.updatedAt);
          setRows(next.slice(0, max));
        },
        (err) => {
          // Index/permission failures shouldn't crash the sidebar — just
          // log and render nothing.
          console.warn("[useRecentChats] subscription failed:", err);
          setRows([]);
        },
      );
    } catch (err) {
      console.warn("[useRecentChats] could not subscribe:", err);
    }
    return () => {
      if (unsub) unsub();
    };
  }, [uid, max]);

  return useMemo(() => rows, [rows]);
}
