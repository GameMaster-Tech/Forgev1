"use client";

/**
 * useDocumentAutosave — bulletproof autosave for the document editor.
 *
 * Goals (and how they're met):
 *
 *   • Explicit states — `saved | saving | dirty | error | conflict`,
 *     surfaced so the UI can show an honest indicator (never a lying
 *     "Saved").
 *
 *   • Retry on failure — a transient write failure (flaky network) flips
 *     to `error` and retries with exponential backoff; the pending edit
 *     is never dropped, so the data survives the outage.
 *
 *   • Conflict-safe writes — every save is an optimistic-concurrency
 *     transaction keyed on a server `rev` counter. If a second tab/device
 *     wrote first we land in `conflict` and stop auto-writing rather than
 *     clobbering the other edit; the user resolves explicitly.
 *
 *   • Zero data loss across reload — a debounced save is flushed on
 *     unmount, and a `beforeunload` guard warns if a save is still
 *     pending so the user can't navigate away mid-write.
 *
 * The hook owns the pending buffer (title/content/wordCount). Callers
 * push edits via `queueContent` / `queueTitle`; the hook coalesces them
 * into a single revisioned write.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  saveDocumentRevision,
  getDocumentRevision,
  DocumentConflictError,
} from "@/lib/firebase/firestore";

export type AutosaveStatus = "saved" | "dirty" | "saving" | "error" | "conflict";

const DEBOUNCE_MS = 1500;
const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 1000;

interface PendingFields {
  title?: string;
  content?: string;
  wordCount?: number;
}

interface UseDocumentAutosaveResult {
  status: AutosaveStatus;
  lastSavedAt: number | null;
  /** Call once after the document loads to seed the revision cursor. */
  init: (rev: number) => void;
  queueContent: (content: string, wordCount: number) => void;
  queueTitle: (title: string) => void;
  /** Force an immediate save of whatever's pending. */
  flush: () => void;
  /** Manually retry after an `error` state. */
  retry: () => void;
  /** Conflict resolution: overwrite the remote with the local buffer. */
  resolveKeepMine: () => void;
}

export function useDocumentAutosave(
  docId: string,
  projectId?: string,
): UseDocumentAutosaveResult {
  const [status, setStatus] = useState<AutosaveStatus>("saved");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  const revRef = useRef(0);
  const pendingRef = useRef<PendingFields>({});
  const dirtyRef = useRef(false);
  const inFlightRef = useRef(false);
  const retriesRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  // Holds the latest `runSave` so the function can re-invoke itself (drain
  // a buffer that grew mid-write) without referencing its own binding
  // before declaration.
  const runSaveRef = useRef<() => void>(() => {});

  const setStatusSafe = useCallback((s: AutosaveStatus) => {
    if (mountedRef.current) setStatus(s);
  }, []);

  // Core write. Drains the pending buffer through a revisioned
  // transaction. Re-entrancy-guarded so overlapping triggers (debounce +
  // flush + retry) never double-write.
  const runSave = useCallback(async () => {
    if (inFlightRef.current) return;
    if (!dirtyRef.current) return;

    const snapshot = { ...pendingRef.current };
    if (Object.keys(snapshot).length === 0) {
      dirtyRef.current = false;
      setStatusSafe("saved");
      return;
    }

    inFlightRef.current = true;
    setStatusSafe("saving");
    try {
      const nextRev = await saveDocumentRevision(
        docId,
        { data: snapshot, baseRev: revRef.current },
        projectId,
      );
      revRef.current = nextRev;
      retriesRef.current = 0;

      // Clear only the fields we just persisted *if* nothing newer was
      // queued during the write. If the user kept typing, leave the doc
      // dirty so the next cycle saves the fresher value.
      let stillDirty = false;
      for (const key of Object.keys(snapshot) as (keyof PendingFields)[]) {
        if (pendingRef.current[key] === snapshot[key]) {
          delete pendingRef.current[key];
        } else {
          stillDirty = true;
        }
      }
      inFlightRef.current = false;

      if (stillDirty || Object.keys(pendingRef.current).length > 0) {
        dirtyRef.current = true;
        setStatusSafe("dirty");
        runSaveRef.current();
      } else {
        dirtyRef.current = false;
        if (mountedRef.current) {
          setLastSavedAt(Date.now());
          setStatus("saved");
        }
      }
    } catch (err) {
      inFlightRef.current = false;
      if (err instanceof DocumentConflictError) {
        // Another writer won. Don't destroy their work — surface the
        // conflict and keep the local buffer intact for resolveKeepMine.
        setStatusSafe("conflict");
        return;
      }
      // Transient failure — keep the buffer, retry with backoff.
      retriesRef.current += 1;
      setStatusSafe("error");
      if (retriesRef.current <= MAX_RETRIES) {
        const delay = BASE_BACKOFF_MS * 2 ** (retriesRef.current - 1);
        if (backoffRef.current) clearTimeout(backoffRef.current);
        backoffRef.current = setTimeout(() => {
          runSaveRef.current();
        }, delay);
      }
      console.warn(`Autosave failed (attempt ${retriesRef.current}):`, err);
    }
  }, [docId, projectId, setStatusSafe]);

  // Keep the self-invocation ref pointing at the freshest closure.
  useEffect(() => {
    runSaveRef.current = () => {
      void runSave();
    };
  }, [runSave]);

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    if (status === "saved" || status === "saving") setStatusSafe("dirty");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void runSave();
    }, DEBOUNCE_MS);
  }, [runSave, status, setStatusSafe]);

  const init = useCallback((rev: number) => {
    revRef.current = rev;
    retriesRef.current = 0;
    dirtyRef.current = false;
    pendingRef.current = {};
    setStatusSafe("saved");
  }, [setStatusSafe]);

  const queueContent = useCallback(
    (content: string, wordCount: number) => {
      pendingRef.current.content = content;
      pendingRef.current.wordCount = wordCount;
      scheduleSave();
    },
    [scheduleSave],
  );

  const queueTitle = useCallback(
    (title: string) => {
      pendingRef.current.title = title;
      scheduleSave();
    },
    [scheduleSave],
  );

  const flush = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    void runSave();
  }, [runSave]);

  const retry = useCallback(() => {
    retriesRef.current = 0;
    if (backoffRef.current) clearTimeout(backoffRef.current);
    void runSave();
  }, [runSave]);

  // Conflict resolution — adopt the remote revision then re-apply the
  // local buffer on top, so the user's in-progress edit wins without a
  // hard reload (and without an infinite conflict loop).
  const resolveKeepMine = useCallback(() => {
    getDocumentRevision(docId)
      .then((remoteRev) => {
        revRef.current = remoteRev;
        dirtyRef.current = true;
        retriesRef.current = 0;
        void runSave();
      })
      .catch(() => setStatusSafe("error"));
  }, [docId, runSave, setStatusSafe]);

  // Flush on unmount so a debounced edit isn't lost when navigating away.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (backoffRef.current) clearTimeout(backoffRef.current);
      if (dirtyRef.current) void runSave();
    };
  }, [runSave]);

  // Guard hard navigations / tab close while a save is pending.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current || inFlightRef.current || status === "error" || status === "conflict") {
        e.preventDefault();
        e.returnValue = "";
        return "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [status]);

  return {
    status,
    lastSavedAt,
    init,
    queueContent,
    queueTitle,
    flush,
    retry,
    resolveKeepMine,
  };
}
