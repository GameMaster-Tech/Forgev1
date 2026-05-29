"use client";

/**
 * useChatThread — orchestrates a multi-turn chat against /api/research/chat.
 *
 * Lifecycle:
 *   1. Resolve or create a conversation for the current (uid, projectId)
 *      pair on first user turn — keeps unsent threads from creating
 *      empty rows.
 *   2. On send: optimistic-append the user turn, POST the trimmed
 *      transcript + new turn to /api/research/chat, optimistic-append
 *      the assistant turn when it lands, then persist BOTH turns to
 *      Firestore via the existing `appendMessage` helper.
 *   3. Errors surface to `error` and the optimistic turns roll back.
 *
 * State shape:
 *   `messages` is the source of truth for the UI. Server roundtrip
 *   reads existing messages from Firestore on mount.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { auth } from "@/lib/firebase/config";
import {
  appendMessage,
  createConversation,
  getMessages,
  getConversation,
  type FirestoreMessage,
} from "@/lib/firebase/conversations";
import { useChatStream } from "./useChatStream";
import type { AiMode } from "@/lib/ai/models";

export interface ChatTurn {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  /** ISO timestamp set client-side until the Firestore write returns. */
  createdAt: number;
  /** Set while the assistant turn is in flight. */
  pending?: boolean;
  /** Tools the agent invoked while producing this turn (assistant only). */
  steps?: Array<{ turn: number; tool: string; durationMs: number }>;
  /**
   * Live thinking trace — populated DURING the stream and frozen
   * once the final event lands. Each entry is one tool's lifecycle:
   * a label that updates from start → done, plus optional web sources
   * for the "currently browsing" chip strip.
   */
  liveTrace?: LiveTraceItem[];
}

/** One row in the assistant's live thinking trace. */
export interface LiveTraceItem {
  /** Unique key — `<turn>:<tool>:<seq>` so React reconciles cleanly. */
  key: string;
  turn: number;
  tool: string;
  /** Human label shown to the user. Updates from start → done. */
  label: string;
  /** True while the tool is in flight; false once it has returned. */
  inflight: boolean;
  durationMs?: number;
  /** Query the user is seeing the model run (search/answer tools). */
  query?: string;
  /** Top URLs the model is "currently browsing" — populated on done. */
  sources?: { url: string; title?: string }[];
  /** Compact numeric summary ("6 results", "4 docs"). */
  summary?: string;
  /** True when the tool returned an error. */
  errored?: boolean;
}

export interface UseChatThreadOptions {
  /** Active project id. Null means workspace-wide chat. */
  projectId: string | null;
  /** Display name of the project — sent to the model as context. */
  projectName?: string | null;
  /** Existing conversation to resume, when known. */
  initialConversationId?: string | null;
  /** Override the default model — passes through to `createConversation`. */
  modelId?: string;
  aiMode?: AiMode;
  showTrace?: boolean;
}

export interface UseChatThreadApi {
  conversationId: string | null;
  messages: ChatTurn[];
  /**
   * Send a message. Optional second arg switches the chat mode:
   *
   *   send("…")
   *   send("…", { mode: "past-you", asOf: "2026-03-14T00:00:00Z" })
   */
  send: (text: string, opts?: SendOptions) => Promise<void>;
  sending: boolean;
  loading: boolean;
  error: string | null;
  /** Reset to a fresh thread — used by the "New chat" affordance. */
  reset: () => void;
}

export interface SendOptions {
  mode?: "live" | "past-you";
  /** ISO timestamp — required when mode === "past-you". */
  asOf?: string;
}

const MAX_HISTORY_FOR_API = 30;
const GLOBAL_CHAT_PROJECT_ID = "__forge_ai_chat__";

function turnFromMessage(m: FirestoreMessage): ChatTurn {
  return {
    id: m.id,
    role:
      m.role === "user" || m.role === "assistant" || m.role === "system"
        ? m.role
        : "assistant",
    content: m.content ?? "",
    createdAt: m.createdAt?.toMillis?.() ?? Date.now(),
  };
}

function localId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

export function useChatThread({
  projectId,
  projectName,
  initialConversationId,
  modelId = "llama-3.3-70b-versatile",
  aiMode = "standard",
  showTrace = false,
}: UseChatThreadOptions): UseChatThreadApi {
  const [conversationId, setConversationId] = useState<string | null>(
    initialConversationId ?? null,
  );
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamAgent = useChatStream();

  // Hydrate from Firestore when an existing conversation id is supplied.
  useEffect(() => {
    if (!initialConversationId) return;
    let cancelled = false;
    (async () => {
       
      setLoading(true);
      try {
        const u = auth.currentUser;
        const [convo, msgs] = await Promise.all([
          getConversation(initialConversationId),
          getMessages(initialConversationId, { userId: u?.uid }),
        ]);
        if (cancelled) return;
        if (convo) {
          setConversationId(initialConversationId);
          setMessages(msgs.map(turnFromMessage));
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Couldn't load this conversation.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialConversationId]);

  // Track whether we're already creating a conversation so concurrent
  // sends don't race two `addDoc` calls.
  const creatingRef = useRef<Promise<string> | null>(null);

  const ensureConversation = useCallback(
    async (firstUserContent: string): Promise<string> => {
      if (conversationId) return conversationId;
      if (creatingRef.current) return creatingRef.current;
      const user = auth.currentUser;
      if (!user) {
        throw new Error("Sign in to start chatting.");
      }
      const storageProjectId = projectId ?? GLOBAL_CHAT_PROJECT_ID;
      const titleSeed = firstUserContent.slice(0, 60);
      const promise = createConversation(user.uid, {
        projectId: storageProjectId,
        title: titleSeed,
        mode: aiMode === "standard" ? "lightning" : aiMode === "thinking" ? "reasoning" : "deep",
        modelId,
      }).then((id) => {
        setConversationId(id);
        creatingRef.current = null;
        return id;
      });
      creatingRef.current = promise;
      return promise;
    },
    [conversationId, projectId, modelId, aiMode],
  );

  const send = useCallback(
    async (text: string, opts?: SendOptions) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const user = auth.currentUser;
      if (!user) {
        setError("Sign in to start chatting.");
        return;
      }
      const storageProjectId = projectId ?? GLOBAL_CHAT_PROJECT_ID;
      const mode = opts?.mode ?? "live";
      if (mode === "past-you" && !opts?.asOf) {
        setError("Past-You chat needs a date.");
        return;
      }
      setError(null);
      setSending(true);

      const userTurn: ChatTurn = {
        id: localId("u"),
        role: "user",
        content: trimmed,
        createdAt: Date.now(),
      };
      const assistantTurn: ChatTurn = {
        id: localId("a"),
        role: "assistant",
        content: "",
        createdAt: Date.now(),
        pending: true,
      };
      setMessages((prev) => [...prev, userTurn, assistantTurn]);

      try {
        const convoId = await ensureConversation(trimmed);

        // Persist the user turn first — survives a tab reload even if
        // the assistant call fails halfway through.
        const persistedUserId = await appendMessage(convoId, {
          userId: user.uid,
          projectId: storageProjectId,
          role: "user",
          content: trimmed,
        });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === userTurn.id ? { ...m, id: persistedUserId } : m,
          ),
        );

        // Send the recent transcript (excluding the in-flight assistant
        // placeholder + the just-persisted user turn — the API merges
        // the new userMessage itself).
        const history = messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .filter((m) => !m.pending)
          .slice(-MAX_HISTORY_FOR_API)
          .map(({ role, content }) => ({ role, content }));

        // Stream the agent's thinking + tool events live. Each event
        // updates the assistant turn's `liveTrace` in place so the UI
        // can render "Searching the web for 'X'…" → "Found 6 results"
        // chips with source URLs as they land.
        let traceCounter = 0;
        const result = await streamAgent({
          projectId,
          projectName: projectName ?? null,
          modelId,
          aiMode,
          userMessage: trimmed,
          // Filter out system turns — the API only accepts user / assistant.
          history: history.map(({ role, content }) => ({
            role: role as "user" | "assistant",
            content,
          })),
          mode,
          asOf: opts?.asOf,
          onEvent: (event) => {
            if (event.kind === "thinking") {
              if (!showTrace) return;
              const key = `t${event.turn}:think:${traceCounter++}`;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantTurn.id
                    ? {
                        ...m,
                        liveTrace: [
                          ...(m.liveTrace ?? []),
                          {
                            key,
                            turn: event.turn,
                            tool: "thinking",
                            label: event.text,
                            inflight: true,
                          },
                        ],
                      }
                    : m,
                ),
              );
              return;
            }
            if (event.kind === "tool_start") {
              if (!showTrace) return;
              const key = `t${event.turn}:${event.tool}:${traceCounter++}`;
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantTurn.id) return m;
                  // Mark the most recent "thinking" item as finished so
                  // the UI swaps it for the tool chip.
                  const trace = (m.liveTrace ?? []).map((t) =>
                    t.tool === "thinking" && t.inflight
                      ? { ...t, inflight: false }
                      : t,
                  );
                  trace.push({
                    key,
                    turn: event.turn,
                    tool: event.tool,
                    label: event.label,
                    inflight: true,
                    query: event.query,
                  });
                  return { ...m, liveTrace: trace };
                }),
              );
              return;
            }
            if (event.kind === "delta") {
              // Token-level streaming — append to the assistant turn's
              // content in place. Markdown re-renders cheaply on each
              // append; for very long answers we could batch via rAF
              // but the chars/sec from Groq is comfortable.
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantTurn.id
                    ? { ...m, content: (m.content ?? "") + event.text }
                    : m,
                ),
              );
              return;
            }
            if (event.kind === "tool_done") {
              if (!showTrace) return;
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantTurn.id) return m;
                  const trace = (m.liveTrace ?? []).map((t) =>
                    t.tool === event.tool && t.turn === event.turn && t.inflight
                      ? {
                          ...t,
                          label: event.label,
                          inflight: false,
                          durationMs: event.durationMs,
                          sources: event.sources,
                          summary: event.summary,
                          errored: event.label.endsWith("failed"),
                        }
                      : t,
                  );
                  return { ...m, liveTrace: trace };
                }),
              );
              return;
            }
            if (event.kind === "error") {
              if (!showTrace) return;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantTurn.id
                    ? {
                        ...m,
                        liveTrace: [
                          ...(m.liveTrace ?? []).map((t) =>
                            t.inflight ? { ...t, inflight: false } : t,
                          ),
                          {
                            key: `t:err:${traceCounter++}`,
                            turn: 0,
                            tool: "error",
                            label: event.message,
                            inflight: false,
                            errored: true,
                          },
                        ],
                      }
                    : m,
                ),
              );
            }
          },
        });
        const reply = (result.message ?? "").trim();
        // Compact steps for persisted history (the assistant turn stays
        // lightweight in Firestore — liveTrace is in-memory only).
        const stepsForTurn = buildStepsFromTrace(assistantTurn.id);

        const persistedAssistantId = await appendMessage(convoId, {
          userId: user.uid,
          projectId: storageProjectId,
          role: "assistant",
          content: reply,
          modelId,
        });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantTurn.id
              ? {
                  ...m,
                  id: persistedAssistantId,
                  content: reply,
                  pending: false,
                  steps: stepsForTurn,
                  // Freeze any leftover inflight markers.
                  liveTrace: (m.liveTrace ?? []).map((t) =>
                    t.inflight ? { ...t, inflight: false } : t,
                  ),
                }
              : m,
          ),
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Couldn't send the message.";
        setError(message);
        // Roll back the optimistic assistant turn so the user can retry.
        setMessages((prev) =>
          prev.filter((m) => m.id !== assistantTurn.id),
        );
      } finally {
        setSending(false);
      }
    },
    [projectId, projectName, ensureConversation, messages, modelId, aiMode, showTrace, streamAgent, setMessages],
  );

  /**
   * Build a compact `steps` array for the persisted turn. We pull
   * straight from the LATEST messages state so we capture whatever
   * landed during the stream — `messages` in closure scope is one
   * tick behind. Best-effort: if the trace is missing, return undefined.
   */
  function buildStepsFromTrace(
    turnId: string,
  ): Array<{ turn: number; tool: string; durationMs: number }> | undefined {
    // Defer to next paint so React's commit lands first.
    // We can't read the freshest state synchronously from here, so we
    // reach into the current snapshot via a setter trick. The cost is
    // a no-op state set — React skips re-render when the value is the
    // same array reference.
    let snapshot: ChatTurn[] = [];
    setMessages((prev) => {
      snapshot = prev;
      return prev;
    });
    const target = snapshot.find((m) => m.id === turnId);
    if (!target?.liveTrace) return undefined;
    return target.liveTrace
      .filter((t) => t.tool !== "thinking" && t.tool !== "error")
      .map((t) => ({
        turn: t.turn,
        tool: t.tool,
        durationMs: t.durationMs ?? 0,
      }));
  }

  const reset = useCallback(() => {
    setConversationId(null);
    setMessages([]);
    setError(null);
  }, []);

  return {
    conversationId,
    messages,
    send,
    sending,
    loading,
    error,
    reset,
  };
}
