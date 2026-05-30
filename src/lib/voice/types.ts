/**
 * Voice Command Compiler — shared types.
 *
 * The compiler turns one utterance + workspace context into a typed action
 * plan the client executes deterministically. No tools, no agent loop: the
 * model only *understands*; the client *acts*.
 *
 * Pure types — safe on client and server.
 */

export type VoiceSection =
  | "projects"
  | "research"
  | "calendar"
  | "tempo"
  | "teams"
  | "activity"
  | "settings"
  | "home";

/**
 * A single deterministic action. The model emits these; the client maps each to
 * a router push / SDK call / UI op. Names may be returned instead of ids — the
 * client resolves them against the injected context as a fallback.
 */
export type VoiceAction =
  | { type: "navigate"; section: VoiceSection; label?: string }
  | { type: "open_project"; projectId?: string; name?: string }
  | { type: "open_document"; docId?: string; projectId?: string; title?: string }
  | { type: "create_project"; name: string }
  | { type: "create_document"; title: string; projectId?: string; projectName?: string; content?: string }
  | { type: "create_team"; name: string }
  | { type: "delete"; kind: "document" | "project" | "team"; id?: string; name?: string; projectId?: string; label?: string }
  | { type: "search"; query: string }
  | { type: "tempo_plan"; intent: string }
  | { type: "answer"; text: string }
  | { type: "clarify"; question: string };

export type VoiceActionType = VoiceAction["type"];

/** Actions that mutate/destroy and must be confirmed before running. */
export const DESTRUCTIVE_ACTIONS: VoiceActionType[] = ["delete"];

/** Result of compiling one utterance. */
export interface CompileResult {
  actions: VoiceAction[];
  /** 0..1 — overall confidence the plan matches the user's intent. */
  confidence: number;
  /** Short spoken/printed acknowledgement ("Opening the AI project."). */
  speech: string;
}

/* ───────────── injected context (so resolution needs no lookups) ───────────── */

export interface VoiceContext {
  /** Where the user is right now. */
  route: string;
  /** Active project/doc, when on a project/doc surface. */
  currentProjectId: string | null;
  currentDocId: string | null;
  /** The user's projects (id + name) — lets the model resolve names → ids in-shot. */
  projects: { id: string; name: string }[];
  /** A few recent documents for "the doc about X" resolution. */
  recentDocs: { id: string; title: string; projectId: string }[];
  /** Current spatial selection (a tagged element the user hovered/selected). */
  selection: { id: string; label: string; kind: string } | null;
  /** Plain-text the user has selected, if any. */
  textSelection: string | null;
}

export const EMPTY_COMPILE: CompileResult = {
  actions: [],
  confidence: 0,
  speech: "Sorry, I didn't catch that.",
};
