"use client";

/**
 * useCrystallize — drives the cross-doc synthesis flow.
 *
 *   run({ projectId, docIds }) → POST /api/crystallize
 *   saveAsNewDoc()             → creates a new document in the
 *                                same project with the synthesis
 *                                body. Resolves with the new docId
 *                                so the caller can router.push() to
 *                                the editor.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { auth } from "@/lib/firebase/config";
import { createDocument, updateDocument } from "@/lib/firebase/firestore";

export interface CrystalSupport {
  docId: string;
  span: string;
  why: string;
}

export interface CrystalResult {
  title: string;
  thesis: string;
  support: CrystalSupport[];
  counters: CrystalSupport[];
  openQuestions: string[];
  whatToWriteNext: string;
  bodyHtml: string;
  groq?: { model: string; durationMs: number; tokens: { input: number; output: number; total: number } };
}

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

export interface UseCrystallizeApi {
  running: boolean;
  result: CrystalResult | null;
  error: string | null;
  run: (args: { projectId: string; docIds: string[] }) => Promise<void>;
  clear: () => void;
  /** Saves the current result as a new doc in `projectId`. Returns
   * the new docId so the caller can navigate. */
  saveAsNewDoc: (projectId: string) => Promise<string | null>;
}

export function useCrystallize(): UseCrystallizeApi {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CrystalResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(
    async ({ projectId, docIds }: { projectId: string; docIds: string[] }) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setRunning(true);
      setError(null);
      try {
        const headers = await authHeaders();
        const res = await fetch("/api/crystallize", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, docIds }),
          signal: controller.signal,
        });
        if (!res.ok) {
          let detail = `Crystallize failed (${res.status})`;
          try {
            const j = (await res.json()) as { error?: string };
            if (j.error) detail = j.error;
          } catch {
            /* keep default */
          }
          throw new Error(detail);
        }
        const data = (await res.json()) as CrystalResult;
        setResult(data);
      } catch (err) {
        if (err instanceof DOMException && (err.name === "AbortError" || err.name === "TimeoutError")) return;
        setError(err instanceof Error ? err.message : "Couldn't crystallize.");
      } finally {
        if (abortRef.current === controller) setRunning(false);
      }
    },
    [],
  );

  const clear = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  const saveAsNewDoc = useCallback(
    async (projectId: string) => {
      if (!result) return null;
      const user = auth.currentUser;
      if (!user) return null;
      try {
        const id = await createDocument(user.uid, projectId, result.title);
        await updateDocument(id, {
          title: result.title,
          content: result.bodyHtml,
          wordCount: countWords(result.bodyHtml),
        });
        return id;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save.");
        return null;
      }
    },
    [result],
  );

  return useMemo(
    () => ({ running, result, error, run, clear, saveAsNewDoc }),
    [running, result, error, run, clear, saveAsNewDoc],
  );
}

function countWords(html: string): number {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.split(/\s+/).length : 0;
}
