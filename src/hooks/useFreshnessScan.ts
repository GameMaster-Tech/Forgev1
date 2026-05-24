"use client";

/**
 * useFreshnessScan — on-demand Groq scan that flags potentially
 * stale claims across every document in a project.
 *
 * Same architecture as `useProjectContradictions`: client pulls the
 * project's docs through the auth'd Firestore SDK, POSTs them to the
 * stateless freshness proxy. Server route is admin-SDK-free.
 *
 * Strictly user-triggered.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { auth } from "@/lib/firebase/config";
import { getProjectDocuments } from "@/lib/firebase/firestore";
import type { FreshnessItem } from "@/app/api/pulse/freshness-scan/route";

export type { FreshnessItem };

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

export interface UseFreshnessScanApi {
  items: FreshnessItem[];
  scannedDocs: number;
  scanning: boolean;
  lastScanAt: number | null;
  error: string | null;
  scan: () => Promise<void>;
  clear: () => void;
}

const MAX_DOCS = 20;

export function useFreshnessScan(projectId: string | null): UseFreshnessScanApi {
  const [items, setItems] = useState<FreshnessItem[]>([]);
  const [scannedDocs, setScannedDocs] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [lastScanAt, setLastScanAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const scan = useCallback(async () => {
    if (!projectId) {
      setError("Pick a project first.");
      return;
    }
    const user = auth.currentUser;
    if (!user) {
      setError("Sign in first.");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setScanning(true);
    setError(null);
    try {
      const allDocs = await getProjectDocuments(projectId, user.uid);
      const docs = allDocs.slice(0, MAX_DOCS).map((d) => ({
        id: d.id,
        title: d.title,
        content: d.content ?? "",
      }));
      const totalChars = docs.reduce((n, d) => n + d.content.length, 0);
      console.log(
        `[freshness:client] project=${projectId} fetched=${allDocs.length} sending=${docs.length} totalHtmlChars=${totalChars}`,
      );
      if (docs.length === 0) {
        setItems([]);
        setScannedDocs(0);
        setLastScanAt(Date.now());
        setError("No documents in this project yet. Create a doc, write something, then re-check.");
        return;
      }
      const headers = await authHeaders();
      const res = await fetch("/api/pulse/freshness-scan", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, docs }),
        signal: controller.signal,
      });
      if (!res.ok) {
        let detail = `Check failed (${res.status})`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j.error) detail = j.error;
        } catch {
          /* keep default */
        }
        throw new Error(detail);
      }
      const data = (await res.json()) as {
        items?: FreshnessItem[];
        scannedDocs?: number;
      };
      setItems(Array.isArray(data.items) ? data.items : []);
      setScannedDocs(typeof data.scannedDocs === "number" ? data.scannedDocs : 0);
      setLastScanAt(Date.now());
    } catch (err) {
      if (
        err instanceof DOMException &&
        (err.name === "AbortError" || err.name === "TimeoutError")
      ) {
        return;
      }
      setError(err instanceof Error ? err.message : "Couldn't run the check.");
    } finally {
      if (abortRef.current === controller) {
        setScanning(false);
      }
    }
  }, [projectId]);

  const clear = useCallback(() => {
    setItems([]);
    setScannedDocs(0);
    setLastScanAt(null);
    setError(null);
  }, []);

  return useMemo(
    () => ({ items, scannedDocs, scanning, lastScanAt, error, scan, clear }),
    [items, scannedDocs, scanning, lastScanAt, error, scan, clear],
  );
}
