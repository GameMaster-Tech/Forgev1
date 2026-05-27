/**
 * AI tool calling — shared types for the registry.
 *
 * A "tool" pairs:
 *
 *   1. A `ToolDefinition` (the JSON-Schema-ish spec Groq sees in
 *      `tools[]` and uses to decide when + how to call it)
 *   2. A `ToolHandler` (the server-side TypeScript function that
 *      actually does the work when the model invokes it)
 *
 * The agent loop pulls both from the registry so individual feature
 * modules don't need to know how the wire protocol works.
 *
 * Every handler runs server-side with the authenticated caller's uid
 * bound in `ToolContext`. Tools never trust uid hints in arguments —
 * the agent enforces the binding before dispatch.
 */

import "server-only";
import type { ToolDefinition } from "@/lib/ai/groq";

export type { ToolDefinition };

export interface ToolContext {
  /** Verified Firebase uid of the caller. The agent injects this; tools must trust it. */
  uid: string;
  /** Active project the agent is operating on, when applicable. */
  projectId: string | null;
  /** Wall-clock when the agent loop started — useful for "today"-relative scheduling. */
  startedAt: number;
  /**
   * Past-You temporal bound — when set, tools that support
   * temporal scoping (see `past-you.ts`) filter to artifacts that
   * existed at or before this ISO timestamp. Ignored by tools that
   * have no temporal meaning.
   */
  asOf?: string;
}

/**
 * Tool handler. Receives the parsed arguments object (already JSON-
 * parsed from the model's string), returns a JSON-serialisable
 * result. Throw to surface an error to the model on the next turn.
 */
export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<unknown> | unknown;

export interface Tool {
  /** The exact `function.name` the model will use when invoking. */
  name: string;
  definition: ToolDefinition;
  handler: ToolHandler;
  /**
   * Optional category — surfaced in logs so it's easy to see which
   * tool domain the model spent time in.
   */
  category?: "calendar" | "tasks" | "docs" | "research" | "system";
}

/**
 * Wraps an unknown error so the model gets a clean string back
 * instead of a stack trace.
 */
export function toolError(message: string, detail?: unknown): { error: string; detail?: unknown } {
  return { error: message, ...(detail !== undefined ? { detail } : {}) };
}
