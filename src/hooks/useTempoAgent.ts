"use client";

/**
 * useTempoAgent — drives the Groq-powered Tempo scheduler from the UI.
 *
 * Sends `{ projectId, intent, horizonDays?, previewOnly? }` to
 * /api/tempo/agent and surfaces the structured plan + agent steps so
 * the panel can render diffs and "what the agent did" alongside.
 *
 * Strictly user-triggered — never fires on mount. Force-refreshes the
 * Firebase ID token before sending (consistent with every other AI
 * call in Forge).
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { auth } from "@/lib/firebase/config";
import type { TempoPlan } from "@/app/api/tempo/agent/route";

export type { TempoPlan };

export interface TempoAgentStep {
  turn: number;
  tool: string;
  durationMs: number;
  result: unknown;
}

export interface TempoAgentResponse {
  message: string;
  plan: TempoPlan | null;
  steps: TempoAgentStep[];
  tokens: { input: number; output: number; total: number };
  model: string;
  durationMs: number;
  finishReason: "complete" | "max-turns" | "error";
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

export interface UseTempoAgentApi {
  /** Last completed response. */
  response: TempoAgentResponse | null;
  running: boolean;
  error: string | null;
  /** Fire a new plan request. */
  plan: (args: { intent: string; horizonDays?: number; previewOnly?: boolean }) => Promise<void>;
  /** Drop the current response. */
  clear: () => void;
}

export function useTempoAgent(projectId: string | null): UseTempoAgentApi {
  const [response, setResponse] = useState<TempoAgentResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const plan = useCallback(
    async (args: { intent: string; horizonDays?: number; previewOnly?: boolean }) => {
      if (!projectId) {
        setError("Pick a project first.");
        return;
      }
      const intent = args.intent.trim();
      if (!intent) {
        setError("Type what you want the agent to plan.");
        return;
      }
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setRunning(true);
      setError(null);
      try {
        const headers = await authHeaders();
        const res = await fetch("/api/tempo/agent", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            intent,
            horizonDays: args.horizonDays ?? 7,
            previewOnly: args.previewOnly ?? true,
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          let detail = `Plan failed (${res.status})`;
          try {
            const j = (await res.json()) as { error?: string };
            if (j.error) detail = j.error;
          } catch {
            /* keep default */
          }
          throw new Error(detail);
        }
        const data = (await res.json()) as TempoAgentResponse;
        setResponse(data);
      } catch (err) {
        if (
          err instanceof DOMException &&
          (err.name === "AbortError" || err.name === "TimeoutError")
        ) {
          return;
        }
        setError(err instanceof Error ? err.message : "Couldn't run the agent.");
      } finally {
        if (abortRef.current === controller) setRunning(false);
      }
    },
    [projectId],
  );

  const clear = useCallback(() => {
    setResponse(null);
    setError(null);
  }, []);

  return useMemo(
    () => ({ response, running, error, plan, clear }),
    [response, running, error, plan, clear],
  );
}
