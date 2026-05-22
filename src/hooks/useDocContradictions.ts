"use client";

/**
 * useDocContradictions — on-demand intra-document contradiction
 * scanner.
 *
 * Earlier versions ran on every editor update with a debounce, which
 * meant Groq was billed every time the user paused typing for ~1.4s.
 * That's wasteful and surprising — the user expects AI calls to fire
 * only when they explicitly ask. So this hook is now strictly manual:
 * call `rescan()` from a "Check for contradictions" button, get back
 * a populated `contradictions` array, optionally clear it with
 * `clear()` when the doc has been edited enough that the previous
 * scan is stale.
 *
 * Same philosophy applies across Forge's other LLM features
 * (writing assistant, Pulse refactor draft, Tempo explain): they all
 * fire only on explicit user action.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { auth } from "@/lib/firebase/config";
import type { IntradocContradiction } from "@/app/api/forge-graph/contradiction-scan/route";

export type { IntradocContradiction };

const MIN_CHARS = 80;

async function authHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) return {};
  try {
    const token = await user.getIdToken();
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
  }
}

export interface UseDocContradictionsApi {
  contradictions: IntradocContradiction[];
  scanning: boolean;
  lastScanAt: number | null;
  /** True when the doc has been edited since the last scan. */
  staleSinceLastScan: boolean;
  /**
   * Trigger a scan against the editor's current text. Idempotent on
   * the SAME text — won't re-bill Groq for an unchanged document.
   */
  rescan: () => Promise<void>;
  /** Drop the current results without scanning. */
  clear: () => void;
}

export interface UseDocContradictionsOptions {
  editor: Editor | null;
}

export function useDocContradictions({
  editor,
}: UseDocContradictionsOptions): UseDocContradictionsApi {
  const [contradictions, setContradictions] = useState<IntradocContradiction[]>(
    [],
  );
  const [scanning, setScanning] = useState(false);
  const [lastScanAt, setLastScanAt] = useState<number | null>(null);
  const [scannedText, setScannedText] = useState<string | null>(null);

  // Abandon in-flight requests when the user re-triggers.
  const abortRef = useRef<AbortController | null>(null);

  const rescan = useCallback(async () => {
    if (!editor) return;
    const text = editor.state.doc.textContent.trim();
    if (text.length < MIN_CHARS) {
      setContradictions([]);
      setLastScanAt(Date.now());
      setScannedText(text);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setScanning(true);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/forge-graph/contradiction-scan", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      if (!res.ok) {
        setContradictions([]);
        return;
      }
      const data = (await res.json()) as {
        contradictions?: IntradocContradiction[];
      };
      setContradictions(
        Array.isArray(data.contradictions) ? data.contradictions : [],
      );
      setScannedText(text);
      setLastScanAt(Date.now());
    } catch (err) {
      if (
        err instanceof DOMException &&
        (err.name === "AbortError" || err.name === "TimeoutError")
      ) {
        return;
      }
      console.warn("[contradictions] scan failed:", err);
    } finally {
      if (abortRef.current === controller) {
        setScanning(false);
      }
    }
  }, [editor]);

  const clear = useCallback(() => {
    setContradictions([]);
    setScannedText(null);
    setLastScanAt(null);
  }, []);

  // Compare current editor text against the snapshot we scanned so
  // the UI can flag "your scan is out of date" without forcing
  // another network call.
  const staleSinceLastScan = useMemo(() => {
    if (!lastScanAt || !editor || scannedText == null) return false;
    return editor.state.doc.textContent.trim() !== scannedText;
  }, [editor, scannedText, lastScanAt]);

  return useMemo(
    () => ({
      contradictions,
      scanning,
      lastScanAt,
      staleSinceLastScan,
      rescan,
      clear,
    }),
    [contradictions, scanning, lastScanAt, staleSinceLastScan, rescan, clear],
  );
}
