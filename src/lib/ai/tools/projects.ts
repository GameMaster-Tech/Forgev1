/**
 * Project tools — list / create Forge projects.
 *
 * Gives the agent the two capabilities it was missing: resolve a project
 * by NAME (so "the decision-making project" maps to an id) and create a
 * new project (so "make a project called AI" works). Pair with the docs
 * tools so the agent can do "create a project + a doc + write it" in one
 * run.
 *
 * Writes go through the admin Firestore SDK and mirror the shape written
 * by `createProject` in src/lib/firebase/firestore.ts.
 */

import "server-only";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import type { Tool, ToolContext } from "./types";
import { toolError } from "./types";

/* The project `mode` field persists in Firestore for back-compat, but it is
 * no longer user/agent-selectable — every project uses one default. */
const DEFAULT_MODE = "reasoning";

/* ─────────────────────────── list ─────────────────────────── */

const listProjects: Tool = {
  name: "projects_list",
  category: "docs",
  definition: {
    type: "function",
    function: {
      name: "projects_list",
      description:
        "List the user's projects (id, name, mode, docCount). Use this FIRST to resolve a project the user refers to by name (e.g. \"the decision-making project\") into its id before creating docs in it.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max projects to return (default 50)." },
        },
        required: [],
      },
    },
  },
  handler: async (args, ctx: ToolContext) => {
    const limit = Math.min(typeof args.limit === "number" ? args.limit : 50, 100);
    const fs = getAdminFirestore();
    const snap = await fs
      .collection("projects")
      .where("userId", "==", ctx.uid)
      .limit(limit)
      .get();
    const projects = snap.docs
      .map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          name: typeof data.name === "string" ? data.name : "Untitled",
          mode: data.mode ?? "reasoning",
          docCount: data.docCount ?? 0,
          status: data.status ?? "active",
        };
      })
      .filter((p) => p.status !== "archived");
    return { projects, count: projects.length };
  },
};

/* ─────────────────────────── create ─────────────────────────── */

const createProject: Tool = {
  name: "projects_create",
  category: "docs",
  definition: {
    type: "function",
    function: {
      name: "projects_create",
      description:
        "Create a new project (workspace). Returns the new project's id, which you can then pass to docs_create. Do NOT create a project if one with the same name already exists — call projects_list first and reuse it.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Project name." },
          systemInstructions: {
            type: "string",
            description: "Optional guidance for how the AI should work in this project.",
          },
        },
        required: ["name"],
      },
    },
  },
  handler: async (args, ctx: ToolContext) => {
    const name = typeof args.name === "string" ? args.name.trim() : "";
    if (!name) return toolError("name is required");
    const systemInstructions =
      typeof args.systemInstructions === "string" ? args.systemInstructions : "";

    const fs = getAdminFirestore();

    // Reuse an existing same-named project rather than duplicating it.
    const existing = await fs
      .collection("projects")
      .where("userId", "==", ctx.uid)
      .where("name", "==", name)
      .limit(1)
      .get();
    if (!existing.empty) {
      return { ok: true, id: existing.docs[0].id, name, reused: true };
    }

    const ref = fs.collection("projects").doc();
    await ref.set({
      userId: ctx.uid,
      name,
      mode: DEFAULT_MODE,
      systemInstructions,
      queryCount: 0,
      docCount: 0,
      status: "active",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, id: ref.id, name, reused: false };
  },
};

export const PROJECT_TOOLS: Tool[] = [listProjects, createProject];
