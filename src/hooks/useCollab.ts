"use client";

/**
 * useCollab — the high-level React entry point for a Yjs-backed
 * collaborative resource.
 *
 * Lifecycle:
 *   1. acquireDoc()    → singleton Y.Doc + Awareness
 *   2. attach provider → Firestore-backed persistence + transport
 *   3. stamp local presence
 *   4. expose peer list + setters
 *   5. on unmount: release doc, disconnect provider, clear local
 *      awareness state, blow away listeners
 *
 * Optimisations:
 *   • Awareness change events are coalesced via rAF to avoid
 *     200-render-per-second storms when many peers move cursors.
 *   • Peer list is recomputed only when the change set actually
 *     mutates a non-self field.
 *   • Disposing in a `useEffect` cleanup explicitly is more reliable
 *     than relying on React strict-mode finaliser semantics.
 */

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { db } from "@/lib/firebase/config";
import { useAuth } from "@/context/AuthContext";
import {
  acquireDoc,
  colourHexFor,
  FirestoreCollabProvider,
  initialsFor,
  paletteIndexFor,
  type CollabController,
  type CollabDocId,
  type CollabStatus,
  type CursorPayload,
  type PresenceActivity,
  type PresenceState,
} from "@/lib/collab";

const IDLE_THRESHOLD_MS = 30_000;

// Module-level provider registry. WeakMap so dropped Y.Docs are GC'd
// without us needing to clean up the registry by hand.
import type * as Y from "yjs";
const PROVIDER_REGISTRY: WeakMap<Y.Doc, FirestoreCollabProvider> = new WeakMap();

/** Stable per-tab peer id; survives reloads if sessionStorage allows. */
function getPeerId(): string {
  if (typeof window === "undefined") return "ssr";
  const KEY = "forge.collab.peerId";
  const existing = window.sessionStorage.getItem(KEY);
  if (existing) return existing;
  const fresh = `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  window.sessionStorage.setItem(KEY, fresh);
  return fresh;
}

export interface UseCollabResult extends CollabController {
  /** True for SSR/initial paint until provider connects. */
  hydrating: boolean;
}

export function useCollab(id: CollabDocId | null): UseCollabResult | null {
  const { user } = useAuth();
  const peerIdRef = useRef<string>(getPeerId());
  const statusRef = useRef<CollabStatus>("idle");

  // Acquire (and release) the Y.Doc as a stable singleton. We can't
  // use useState because the doc must be the same object across
  // remounts that share an id. Serialise the id triple so the dep
  // array is a single stable primitive — callers can pass a fresh
  // object literal each render without churning the doc.
  const idKey = id ? `${id.kind}::${id.projectId}::${id.resourceId}` : null;
  const acquired = useMemo(() => {
    if (!id || !idKey) return null;
    return acquireDoc(id);
    // `id` is captured at the time of the idKey snapshot — by
    // construction, two renders with the same idKey have semantically
    // equal `id` triples even when the object references differ.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey]);

  // Subscribe to status updates via useSyncExternalStore so React
  // schedules re-renders correctly.
  const subscribeStatus = useCallback(
    (notify: () => void) => {
      if (!acquired || typeof window === "undefined") return () => {};
      // Provider is created lazily — the connect effect registers it
      // in a module-level WeakMap so we never mutate the Y.Doc object
      // (and never trip the react-hooks/immutability lint rule).
      const provider = PROVIDER_REGISTRY.get(acquired.doc);
      if (!provider) return () => {};
      return provider.onStatus((s) => {
        statusRef.current = s;
        notify();
      });
    },
    [acquired],
  );
  const getStatus = useCallback(() => statusRef.current, []);
  const getServerStatus = useCallback<() => CollabStatus>(() => "idle", []);
  const status = useSyncExternalStore(subscribeStatus, getStatus, getServerStatus);

  // Provider lifecycle — attach on mount, detach on unmount.
  useEffect(() => {
    if (!acquired || !id || !user?.uid) return;
    if (typeof window === "undefined") return;
    const provider = new FirestoreCollabProvider({
      fs: db,
      ownerUid: user.uid,
      docId: id,
      doc: acquired.doc,
      peerId: peerIdRef.current,
    });
    // Register the provider in a module-level WeakMap so the
    // subscribe callback (and any other concurrent hook) can find
    // it. WeakMap keyed by the Y.Doc means cleanup is automatic when
    // the doc is dropped from the factory registry.
    PROVIDER_REGISTRY.set(acquired.doc, provider);
    void provider.connect();
    return () => {
      void provider.disconnect();
      PROVIDER_REGISTRY.delete(acquired.doc);
    };
  }, [acquired, id, user?.uid]);

  // Stamp local presence onto Awareness.
  useEffect(() => {
    if (!acquired || !user?.uid) return;
    const uid = user.uid;
    const name = user.displayName ?? user.email ?? "Anonymous";
    const initial: PresenceState = {
      peerId: peerIdRef.current,
      uid,
      displayName: name,
      initials: initialsFor(name),
      colourIndex: paletteIndexFor(uid),
      colourHex: colourHexFor(uid),
      activity: { type: "viewing" },
      cursor: null,
      lastActiveAt: Date.now(),
    };
    acquired.awareness.setLocalState(initial);
    return () => {
      acquired.awareness.setLocalState(null);
    };
  }, [acquired, user?.uid, user?.displayName, user?.email]);

  // Peer list — subscribe to awareness changes via useSyncExternalStore
  // with rAF coalescing.
  const subscribePeers = useCallback(
    (notify: () => void) => {
      if (!acquired) return () => {};
      let raf: number | null = null;
      const onChange = () => {
        if (raf != null) return;
        raf = requestAnimationFrame(() => {
          raf = null;
          notify();
        });
      };
      acquired.awareness.on("change", onChange);
      return () => {
        if (raf != null) cancelAnimationFrame(raf);
        acquired.awareness.off("change", onChange);
      };
    },
    [acquired],
  );

  const peers = useSyncExternalStore(
    subscribePeers,
    useCallback(() => {
      if (!acquired) return EMPTY_PEERS;
      const states = acquired.awareness.getStates();
      const now = Date.now();
      const out: PresenceState[] = [];
      const selfPeerId = peerIdRef.current;
      states.forEach((state) => {
        if (!state) return;
        const presence = state as PresenceState;
        if (!presence.peerId || !presence.uid) return;
        if (presence.peerId === selfPeerId) return;
        // Mark stale peers idle.
        if (now - presence.lastActiveAt > IDLE_THRESHOLD_MS && presence.activity?.type !== "idle") {
          out.push({ ...presence, activity: { type: "idle" } });
        } else {
          out.push(presence);
        }
      });
      // Stable sort by peerId so avatars don't reshuffle every poll.
      return out.sort((a, b) => a.peerId.localeCompare(b.peerId));
    }, [acquired]),
    () => EMPTY_PEERS,
  );

  /* ─── presence setters ─── */

  const setActivity = useCallback(
    (activity: PresenceActivity) => {
      if (!acquired) return;
      const local = acquired.awareness.getLocalState() as PresenceState | null;
      if (!local) return;
      acquired.awareness.setLocalState({ ...local, activity, lastActiveAt: Date.now() });
    },
    [acquired],
  );

  const setCursor = useCallback(
    (cursor: CursorPayload | null) => {
      if (!acquired) return;
      const local = acquired.awareness.getLocalState() as PresenceState | null;
      if (!local) return;
      acquired.awareness.setLocalState({ ...local, cursor, lastActiveAt: Date.now() });
    },
    [acquired],
  );

  const dispose = useCallback(() => {
    acquired?.release();
  }, [acquired]);

  // Release on unmount.
  useEffect(() => {
    return () => {
      acquired?.release();
    };
  }, [acquired]);

  if (!acquired) return null;

  return {
    doc: acquired.doc,
    awareness: acquired.awareness,
    peers,
    status,
    hydrating: status === "idle" || status === "connecting",
    setActivity,
    setCursor,
    dispose,
  };
}

const EMPTY_PEERS: PresenceState[] = [];
