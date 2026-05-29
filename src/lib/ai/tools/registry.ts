/**
 * Tool registry — single import for the agent loop.
 *
 * Different agent surfaces want different tool subsets. A pure
 * Tempo scheduler doesn't need to read docs; the Research chat
 * doesn't need to delete calendar events. Build a registry per
 * surface from these named groups.
 *
 * Usage:
 *
 *   const tools = buildRegistry({
 *     groups: ["calendar", "tasks", "docs:read"],
 *   });
 *   const { definitions, dispatch } = tools;
 *   // pass `definitions` to groqChat({ tools }),
 *   // pass `dispatch(name, args, ctx)` to the agent runner.
 */

import "server-only";
import type { Tool, ToolContext, ToolDefinition } from "./types";
import { CALENDAR_TOOLS } from "./calendar";
import { DOC_TOOLS } from "./docs";
import { PROJECT_TOOLS } from "./projects";
import { RESEARCH_TOOLS } from "./research";
import { PAST_YOU_TOOLS } from "./past-you";

export type ToolGroup =
  | "calendar"
  | "tasks"
  | "docs"
  | "docs:read"
  | "projects"
  | "research"
  | "past-you"
  | "all";

/** Flat list of every tool by id. */
const ALL_TOOLS: Tool[] = [
  ...CALENDAR_TOOLS,
  ...DOC_TOOLS,
  ...PROJECT_TOOLS,
  ...RESEARCH_TOOLS,
  ...PAST_YOU_TOOLS,
];
const BY_NAME = new Map(ALL_TOOLS.map((t) => [t.name, t] as const));

function expandGroups(groups: ToolGroup[]): Tool[] {
  const set = new Set<Tool>();
  for (const g of groups) {
    if (g === "all") {
      ALL_TOOLS.forEach((t) => set.add(t));
      continue;
    }
    if (g === "calendar") {
      CALENDAR_TOOLS.filter((t) => t.category === "calendar").forEach((t) => set.add(t));
      continue;
    }
    if (g === "tasks") {
      CALENDAR_TOOLS.filter((t) => t.category === "tasks").forEach((t) => set.add(t));
      continue;
    }
    if (g === "docs") {
      DOC_TOOLS.forEach((t) => set.add(t));
      continue;
    }
    if (g === "docs:read") {
      DOC_TOOLS.filter((t) => t.name === "docs_list" || t.name === "docs_read").forEach(
        (t) => set.add(t),
      );
      continue;
    }
    if (g === "projects") {
      PROJECT_TOOLS.forEach((t) => set.add(t));
      continue;
    }
    if (g === "research") {
      RESEARCH_TOOLS.forEach((t) => set.add(t));
      continue;
    }
    if (g === "past-you") {
      PAST_YOU_TOOLS.forEach((t) => set.add(t));
      continue;
    }
  }
  return Array.from(set);
}

export interface BuiltRegistry {
  definitions: ToolDefinition[];
  tools: Tool[];
  /** Dispatch a tool call by name. Returns the JSON-serialisable result the agent will hand back to the model. */
  dispatch: (
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<unknown>;
}

export function buildRegistry(opts: { groups: ToolGroup[] }): BuiltRegistry {
  const tools = expandGroups(opts.groups);
  return {
    tools,
    definitions: tools.map((t) => t.definition),
    dispatch: async (name, args, ctx) => {
      const tool = BY_NAME.get(name);
      if (!tool) {
        return { error: `Unknown tool: ${name}` };
      }
      try {
        return await tool.handler(args, ctx);
      } catch (err) {
        const message = err instanceof Error ? err.message : "tool failed";
        console.error(`[tool:${name}] ✗ ${message}`);
        return { error: message };
      }
    },
  };
}

/** Direct lookup — for tests or manual invocation. */
export function getTool(name: string): Tool | undefined {
  return BY_NAME.get(name);
}
