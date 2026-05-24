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

export interface ChatTurn {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  /** ISO timestamp set client-side until the Firestore write returns. */
  createdAt: number;
  /** Set while the assistant turn is in flight. */
  pending?: boolean;
}

export interface UseChatThreadOptions {
  /** Currently active project id; required for chat persistence. */
  projectId: string | null;
  /** Display name of the project — sent to the model as context. */
  projectName?: string | null;
  /** Existing conversation to resume, when known. */
  initialConversationId?: string | null;
  /** Override the default model — passes through to `createConversation`. */
  modelId?: string;
}

export interface UseChatThreadApi {
  conversationId: string | null;
  messages: ChatTurn[];
  send: (text: string) => Promise<void>;
  sending: boolean;
  loading: boolean;
  error: string | null;
  /** Reset to a fresh thread — used by the "New chat" affordance. */
  reset: () => void;
}

const MAX_HISTORY_FOR_API = 30;

/**
 * Force-refresh the Firebase ID token before each chat send.
 *
 * Why force: `getIdToken()` returns a cached token that may have
 * expired (>1h) even though the SDK believes the user is logged in.
 * When the server calls `verifyIdToken(token, true)` with the
 * checkRevoked flag the stale token fails with "Invalid or expired
 * token" — exactly the error the user saw. Passing `true` here
 * triggers a refresh against Google's STS so the server always sees a
 * fresh token.
 */
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
}: UseChatThreadOptions): UseChatThreadApi {
  const [conversationId, setConversationId] = useState<string | null>(
    initialConversationId ?? null,
  );
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      if (!user || !projectId) {
        throw new Error("Sign in and select a project to start chatting.");
      }
      const titleSeed = firstUserContent.slice(0, 60);
      const promise = createConversation(user.uid, {
        projectId,
        title: titleSeed,
        mode: "reasoning",
        modelId,
      }).then((id) => {
        setConversationId(id);
        creatingRef.current = null;
        return id;
      });
      creatingRef.current = promise;
      return promise;
    },
    [conversationId, projectId, modelId],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const user = auth.currentUser;
      if (!user || !projectId) {
        setError("Sign in and select a project to start chatting.");
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
          projectId,
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

        const headers = await authHeaders();
        const res = await fetch("/api/research/chat", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            projectName,
            history,
            userMessage: trimmed,
          }),
        });
        if (!res.ok) {
          let detail = `Chat failed (${res.status})`;
          try {
            const data = (await res.json()) as { error?: string };
            if (data.error) detail = data.error;
          } catch {
            /* fall through */
          }
          throw new Error(detail);
        }
        const data = (await res.json()) as {
          content?: string;
        };
        const reply = (data.content ?? "").trim();

        const persistedAssistantId = await appendMessage(convoId, {
          userId: user.uid,
          projectId,
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
    [projectId, projectName, ensureConversation, messages, modelId],
  );

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
