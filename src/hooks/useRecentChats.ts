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
  orderBy,
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
      setRows([]);
      return;
    }
    let unsub: Unsubscribe | null = null;
    try {
      const q = query(
        collection(db, "conversations"),
        where("userId", "==", uid),
        where("archived", "==", false),
        orderBy("updatedAt", "desc"),
        fbLimit(max),
      );
      unsub = onSnapshot(
        q,
        (snap) => {
          const next: RecentChat[] = [];
          for (const d of snap.docs) {
            const data = d.data() as FirestoreConversation;
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
          setRows(next);
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
