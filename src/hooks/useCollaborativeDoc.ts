"use client";

/**
 * useCollaborativeDoc — owns the Y.Doc + FirestoreYjsProvider lifecycle
 * for a single document. The Y.Doc is created synchronously so it can be
 * handed to the editor on first render (Tiptap's Collaboration extension
 * needs a stable document at construction time); the provider connects
 * to Firestore in the background and flips `synced` when the initial
 * state has been applied.
 *
 * `hadInitialState` tells the caller whether the doc already had
 * persisted Yjs state — used to decide whether to seed a freshly
 * migrated (HTML-only) document into the shared Y.Doc exactly once.
 */

import { useEffect, useMemo, useState } from "react";
import { Doc as YDoc } from "yjs";
import { db } from "@/lib/firebase/config";
import { FirestoreYjsProvider } from "@/lib/collab/firestore-yjs-provider";

export interface CollaborativeDoc {
  ydoc: YDoc;
  synced: boolean;
  hadInitialState: boolean;
}

export function useCollaborativeDoc(docId: string): CollaborativeDoc {
  // A fresh Y.Doc per document, stable for the life of this page mount.
  const ydoc = useMemo(() => {
    void docId; // recreate the Y.Doc whenever the document changes
    return new YDoc();
  }, [docId]);

  // Tagged with the docId it belongs to so `synced` reads false the
  // instant we navigate to a different document, without a synchronous
  // setState reset inside the effect body.
  const [sync, setSync] = useState<{ docId: string; hadInitialState: boolean } | null>(
    null,
  );

  useEffect(() => {
    const provider = new FirestoreYjsProvider(db, docId, ydoc);
    provider.whenSynced.then((hadState) => {
      setSync({ docId, hadInitialState: hadState });
    });
    return () => provider.destroy();
  }, [docId, ydoc]);

  const synced = sync?.docId === docId;
  return { ydoc, synced, hadInitialState: synced ? sync!.hadInitialState : false };
}
