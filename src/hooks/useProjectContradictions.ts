"use client";

/**
 * useProjectContradictions — on-demand Groq scan across every
 * document in a project.
 *
 * Flow: client (this hook) fetches the project's docs via the
 * authenticated Firestore SDK, posts them to the stateless Groq
 * proxy at `/api/forge-graph/project-contradictions`, and renders
 * the returned pairs. The server route never touches Firestore —
 * keeps the route working without service-account creds.
 *
 * Strictly user-triggered. No debounce.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { auth } from "@/lib/firebase/config";
import { getProjectDocuments } from "@/lib/firebase/firestore";
import type { ProjectContradiction } from "@/app/api/forge-graph/project-contradictions/route";

export type { ProjectContradiction };

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

export interface UseProjectContradictionsApi {
  contradictions: ProjectContradiction[];
  scannedDocs: number;
  scanning: boolean;
  lastScanAt: number | null;
  error: string | null;
  scan: () => Promise<void>;
  clear: () => void;
}

const MAX_DOCS = 20;

export function useProjectContradictions(
  projectId: string | null,
): UseProjectContradictionsApi {
  const [contradictions, setContradictions] = useState<ProjectContradiction[]>([]);
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
      // Pull the project's docs via the client SDK — uses the user's
      // own auth, so no admin SDK / service-account needed.
      const allDocs = await getProjectDocuments(projectId, user.uid);
      const docs = allDocs.slice(0, MAX_DOCS).map((d) => ({
        id: d.id,
        title: d.title,
        content: d.content ?? "",
      }));
      const totalChars = docs.reduce((n, d) => n + d.content.length, 0);
      console.log(
        `[contradictions:client] project=${projectId} fetched=${allDocs.length} sending=${docs.length} totalHtmlChars=${totalChars}`,
      );
      if (docs.length === 0) {
        setContradictions([]);
        setScannedDocs(0);
        setLastScanAt(Date.now());
        setError("No documents in this project yet. Create a doc, write something, then re-check.");
        return;
      }
      const headers = await authHeaders();
      const res = await fetch("/api/forge-graph/project-contradictions", {
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
        contradictions?: ProjectContradiction[];
        scannedDocs?: number;
      };
      setContradictions(
        Array.isArray(data.contradictions) ? data.contradictions : [],
      );
      setScannedDocs(typeof data.scannedDocs === "number" ? data.scannedDocs : 0);
      setLastScanAt(Date.now());
    } catch (err) {
      if (
        err instanceof DOMException &&
        (err.name === "AbortError" || err.name === "TimeoutError")
      ) {
        return;
      }
      setError(
        err instanceof Error ? err.message : "Couldn't run the check.",
      );
    } finally {
      if (abortRef.current === controller) {
        setScanning(false);
      }
    }
  }, [projectId]);

  const clear = useCallback(() => {
    setContradictions([]);
    setScannedDocs(0);
    setLastScanAt(null);
    setError(null);
  }, []);

  return useMemo(
    () => ({ contradictions, scannedDocs, scanning, lastScanAt, error, scan, clear }),
    [contradictions, scannedDocs, scanning, lastScanAt, error, scan, clear],
  );
}
