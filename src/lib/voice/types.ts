/**
 * Voice Command Compiler — shared types.
 *
 * Aria compiles one utterance + workspace context into a typed action plan the
 * client executes deterministically. The action set below is meant to cover
 * EVERY movement and action a user can perform manually in Forge: navigation to
 * any surface, creating/editing/deleting every data type, and UI ops.
 *
 * Pure types — safe on client and server.
 */

export type VoiceSection =
  | "projects"
  | "research"
  | "calendar"
  | "tempo"
  | "goals"
  | "habits"
  | "integrations"
  | "invariants"
  | "teams"
  | "activity"
  | "settings"
  | "preview"
  | "home";

export type VoiceAction =
  /* ── navigation / movement ── */
  | { type: "navigate"; section: VoiceSection; label?: string }
  | { type: "go_back" }
  | { type: "open_project"; projectId?: string; name?: string }
  | { type: "open_project_graph"; projectId?: string; name?: string }
  | { type: "open_project_planner"; projectId?: string; name?: string }
  | { type: "open_document"; docId?: string; projectId?: string; title?: string }
  | { type: "open_team"; teamId?: string; name?: string }
  /* ── create ── */
  | { type: "create_project"; name: string }
  | { type: "create_document"; title: string; projectId?: string; projectName?: string; content?: string }
  | { type: "create_team"; name: string }
  | { type: "seed_workspace"; name?: string }
  | { type: "create_event"; title?: string }
  | { type: "create_task"; title?: string }
  | { type: "create_goal"; title?: string }
  | { type: "create_habit"; title?: string }
  /* ── edit ── */
  | { type: "edit_document"; mode: "append" | "prepend" | "replace"; content: string; docId?: string; projectId?: string }
  | { type: "rename"; kind: "document" | "project"; id?: string; projectId?: string; name: string }
  /* ── delete (confirmed) ── */
  | { type: "delete"; kind: "document" | "project" | "team"; id?: string; name?: string; projectId?: string; label?: string }
  /* ── actions ── */
  | { type: "search"; query: string }
  | { type: "ask"; question: string }
  | { type: "tempo_plan"; intent: string }
  | { type: "command_palette" }
  | { type: "set_theme"; theme: "light" | "dark" | "system" }
  | { type: "toggle_doc_panel"; panel: "research" | "comments" | "related" | "outline" }
  /* ── conversational ── */
  | { type: "answer"; text: string }
  | { type: "clarify"; question: string };

export type VoiceActionType = VoiceAction["type"];

/** Actions that mutate/destroy and must be confirmed before running. */
export const DESTRUCTIVE_ACTIONS: VoiceActionType[] = ["delete"];

/** Every known action type (used by the stream parser to validate directives). */
export const ALL_ACTION_TYPES: VoiceActionType[] = [
  "navigate",
  "go_back",
  "open_project",
  "open_project_graph",
  "open_project_planner",
  "open_document",
  "open_team",
  "create_project",
  "create_document",
  "create_team",
  "seed_workspace",
  "create_event",
  "create_task",
  "create_goal",
  "create_habit",
  "edit_document",
  "rename",
  "delete",
  "search",
  "ask",
  "tempo_plan",
  "command_palette",
  "set_theme",
  "toggle_doc_panel",
  "answer",
  "clarify",
];

export interface CompileResult {
  actions: VoiceAction[];
  confidence: number;
  speech: string;
}

export interface VoiceContext {
  route: string;
  currentProjectId: string | null;
  currentDocId: string | null;
  projects: { id: string; name: string }[];
  recentDocs: { id: string; title: string; projectId: string }[];
  selection: { id: string; label: string; kind: string } | null;
  textSelection: string | null;
  /** What's currently on the user's screen (main content) — so Aria sees what
   *  you see and can resolve "this", "summarize this", "what's on screen". */
  visibleText: string | null;
}

export const EMPTY_COMPILE: CompileResult = {
  actions: [],
  confidence: 0,
  speech: "Sorry, I didn't catch that.",
};
