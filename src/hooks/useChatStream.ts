"use client";

/**
 * useChatStream — low-level consumer of /api/research/chat/stream.
 *
 * Opens a fetch + ReadableStream (not EventSource — POST bodies are
 * needed for the chat payload), parses SSE `data:` lines into
 * AgentEvent objects, and dispatches to the caller's onEvent.
 *
 * Returns a promise that resolves when the server emits `[DONE]` or
 * the stream closes. Throws on transport / non-2xx.
 *
 * The high-level useChatThread hook composes this with optimistic
 * Firestore persistence; this module stays single-purpose.
 */

import { useCallback, useRef } from "react";
import { auth } from "@/lib/firebase/config";
import type { AgentEvent } from "@/lib/ai/agent";

export type { AgentEvent };

async function freshAuthHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) return {};
  try {
    const token = await user.getIdToken(true);
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
  }
}

export interface ChatStreamRequest {
  projectId: string | null;
  projectName: string | null;
  userMessage: string;
  history: { role: "user" | "assistant"; content: string }[];
  systemPrompt?: string;
  /** Abort signal — lets the caller cancel mid-stream. */
  signal?: AbortSignal;
  onEvent: (event: AgentEvent) => void;
}

export interface ChatStreamResult {
  /** Aggregated text from the `final` event. */
  message: string;
  tokens?: { input: number; output: number; total: number };
  finishReason?: "complete" | "max-turns" | "error";
}

export function useChatStream(): (req: ChatStreamRequest) => Promise<ChatStreamResult> {
  // No state — this is a pure invoker. The ref guards against
  // unmounts during a long stream.
  const abortRef = useRef<AbortController | null>(null);

  return useCallback(async (req: ChatStreamRequest) => {
    abortRef.current?.abort();
    const controller = req.signal
      ? null
      : new AbortController();
    if (controller) abortRef.current = controller;
    const signal = req.signal ?? controller!.signal;

    const headers = await freshAuthHeaders();
    const res = await fetch("/api/research/chat/stream", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: req.projectId,
        projectName: req.projectName,
        userMessage: req.userMessage,
        history: req.history,
        ...(req.systemPrompt ? { systemPrompt: req.systemPrompt } : {}),
      }),
      signal,
    });

    if (!res.ok || !res.body) {
      let detail = `Stream failed (${res.status})`;
      try {
        const j = (await res.json()) as { error?: string };
        if (j.error) detail = j.error;
      } catch {
        /* keep default */
      }
      throw new Error(detail);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    const result: ChatStreamResult = { message: "" };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by blank line. Split on \n\n.
      const frames = buffer.split(/\n\n/);
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const lines = frame.split(/\n/).filter(Boolean);
        for (const line of lines) {
          if (line.startsWith(":")) continue; // heartbeat / comment
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") {
            return result;
          }
          let event: AgentEvent;
          try {
            event = JSON.parse(payload) as AgentEvent;
          } catch {
            continue;
          }
          req.onEvent(event);
          if (event.kind === "final") {
            result.message = event.message;
            result.tokens = event.tokens;
            result.finishReason = event.finishReason;
          }
        }
      }
    }

    return result;
  }, []);
}
