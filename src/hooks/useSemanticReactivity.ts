"use client";

/**
 * useSemanticReactivity — debounced semantic-conflict tracker bound to a
 * live TipTap editor.
 *
 * Pipeline:
 *   editor onUpdate
 *     → debounce 800ms
 *     → embed current document plaintext (Voyage AI proxy)
 *     → fan out over every PROSE node in the workspace graph
 *     → for high-similarity matches: LLM contradiction judgement
 *     → expose conflicts + flash trigger
 *
 * The hook never throws. Embedding or LLM failures fall through to an
 * empty conflict list so the editor remains usable offline.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";

import {
  ForgeSyncCompiler,
  checkProseContradiction,
  defaultInvariants,
  embedText,
  type EmbeddingProxy,
  type ForgeGraphNode,
  type LlmValidationProxy,
  type NodeId,
  type SemanticConflict,
  type WorkspaceInvariant,
} from "@/lib/forge-graph";
import { tiptapNodeId } from "@/lib/forge-graph/adapters/tiptap";

export interface UseSemanticReactivityOptions {
  editor: Editor | null;
  /** Firestore document id the editor is bound to. */
  documentId: string | null;
  /** Project the document belongs to — used to scope embeddings. */
  projectId: string | null;
  /** Pre-built graph (PROSE nodes must have semanticEmbedding set). */
  graph: Map<NodeId, ForgeGraphNode>;
  /** Debounce window in ms. Default 800. */
  debounceMs?: number;
  /** Test injection — defaults to Voyage-proxy embed. */
  embeddingProxy?: EmbeddingProxy;
  llmValidationProxy?: LlmValidationProxy;
  /** Custom invariant set — defaults to `defaultInvariants()`. */
  invariants?: WorkspaceInvariant[];
}

export interface SemanticReactivityApi {
  conflicts: SemanticConflict[];
  evaluating: boolean;
  /** Last completed evaluation timestamp (ms epoch). */
  lastEvaluatedAt: number | null;
  /** Force a recheck right now (skips the debounce). */
  reevaluate: () => Promise<void>;
}

export function useSemanticReactivity({
  editor,
  documentId,
  projectId,
  graph,
  debounceMs = 800,
  embeddingProxy = embedText,
  llmValidationProxy = checkProseContradiction,
  invariants,
}: UseSemanticReactivityOptions): SemanticReactivityApi {
  const [conflicts, setConflicts] = useState<SemanticConflict[]>([]);
  const [evaluating, setEvaluating] = useState(false);
  const [lastEvaluatedAt, setLastEvaluatedAt] = useState<number | null>(null);

  const effectiveInvariants = useMemo(
    () => invariants ?? defaultInvariants(),
    [invariants],
  );

  // Pre-embed every PROSE node so the compiler's hot loop can skip the
  // network on hit. The pre-embed runs once per graph identity and
  // mutates the node objects in place (semanticEmbedding is lazily set).
  useEffect(() => {
    let cancelled = false;
    const proseNodes: ForgeGraphNode[] = [];
    for (const node of graph.values()) {
      if (
        node.category === "PROSE" &&
        !node.semanticEmbedding &&
        node.payload.content &&
        node.payload.content.length > 24
      ) {
        proseNodes.push(node);
      }
    }
    if (proseNodes.length === 0) return;
    (async () => {
      // Bounded concurrency — limit to 4 in-flight embeds so we don't
      // saturate the rate limiter.
      const queue = proseNodes.slice();
      const workers: Promise<void>[] = [];
      for (let i = 0; i < 4; i++) {
        workers.push(
          (async () => {
            while (!cancelled) {
              const node = queue.shift();
              if (!node) return;
              try {
                node.semanticEmbedding = await embeddingProxy(node.payload.content);
              } catch {
                /* leave embedding unset; conflict pass will skip it */
              }
            }
          })(),
        );
      }
      await Promise.all(workers);
    })();
    return () => {
      cancelled = true;
    };
  }, [graph, embeddingProxy]);

  const compiler = useMemo(
    () => new ForgeSyncCompiler(graph, effectiveInvariants),
    [graph, effectiveInvariants],
  );

  const evaluate = useCallback(async () => {
    if (!editor || !documentId || !projectId) return;
    const text = editor.state.doc.textContent;
    if (!text || text.trim().length < 24) {
      setConflicts([]);
      return;
    }
    setEvaluating(true);
    try {
      const excludeNodeId = tiptapNodeId(documentId);
      const found = await compiler.evaluateSemanticReactivity(
        text,
        embeddingProxy,
        llmValidationProxy,
        { excludeNodeId },
      );
      setConflicts(found);
      setLastEvaluatedAt(Date.now());
    } catch (err) {
      console.warn("[forge-graph] semantic evaluation failed", err);
      setConflicts([]);
    } finally {
      setEvaluating(false);
    }
  }, [editor, documentId, projectId, compiler, embeddingProxy, llmValidationProxy]);

  // Debounced trigger on every editor update.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void evaluate();
      }, debounceMs);
    };
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [editor, evaluate, debounceMs]);

  const reevaluate = useCallback(async () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    await evaluate();
  }, [evaluate]);

  return { conflicts, evaluating, lastEvaluatedAt, reevaluate };
}
