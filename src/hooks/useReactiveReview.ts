"use client";

/**
 * useReactiveReview — the data behind Calm Review.
 *
 * Scans the signed-in user's documents for Living Sections that have drifted
 * (a source changed since they were generated) and returns them as a calm,
 * workspace-wide to-review list. Deliberately *on demand* — it only scans
 * while the review surface is open, so it never runs as an anxious background
 * poll. Reviewing is something you choose to do, not something that nags you.
 */

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { getUserDocuments } from "@/lib/firebase/firestore";
import { extractLivingSections, hasLivingSections, isDrifted } from "@/lib/reactive/scan";

export interface ReviewItem {
  docId: string;
  docTitle: string;
  projectId: string;
  sectionId: string;
  rule: string;
}

const MAX_DOCS = 80;

export function useReactiveReview(enabled: boolean) {
  const { user } = useAuth();
  const uid = user?.uid;

  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [scannedAt, setScannedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled || !uid) return;
    let cancelled = false;
    // Defer all setState out of the effect body (cascading-render rule).
    const run = setTimeout(() => {
      if (cancelled) return;
      setLoading(true);
      getUserDocuments(uid, MAX_DOCS)
        .then((docs) => {
          if (cancelled) return;
          const found: ReviewItem[] = [];
          for (const d of docs) {
            const content = typeof d.content === "string" ? d.content : "";
            if (!hasLivingSections(content)) continue;
            const projectId = typeof d.projectId === "string" ? d.projectId : "";
            if (!projectId) continue;
            for (const s of extractLivingSections(content)) {
              if (isDrifted(s)) {
                found.push({
                  docId: d.id,
                  docTitle: (d.title ?? "").trim() || "Untitled document",
                  projectId,
                  sectionId: s.id,
                  rule: s.rule.trim() || "Living section",
                });
              }
            }
          }
          setItems(found);
          setScannedAt(Date.now());
        })
        .catch(() => {
          if (!cancelled) setItems([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    });
    return () => {
      cancelled = true;
      clearTimeout(run);
    };
  }, [enabled, uid]);

  return useMemo(
    () => ({ items, loading, scannedAt }),
    [items, loading, scannedAt],
  );
}
