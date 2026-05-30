"use client";

/**
 * Aria executor — runs one VoiceAction deterministically. Covers every movement
 * + action a user can do in Forge: navigation to any surface, create / edit /
 * rename / delete of every data type, and UI ops (command palette, theme, doc
 * panels) dispatched as `aria:ui` events that mounted bridges handle.
 *
 * Server state changes go through the existing client SDK (owner-scoped); deletes
 * await a presence confirmation first. Everything drives the ghost cursor + trail.
 */

import {
  createDocument,
  updateDocument,
  deleteDocument,
  getDocument,
  createProject,
  updateProject,
  deleteProject,
  createTeam,
  deleteTeam,
} from "@/lib/firebase/firestore";
import { usePresenceStore } from "@/store/presence";
import { choreographClick } from "./choreograph";
import { queueDocWrite } from "./handoff";
import type { ConfirmationDecision } from "@/lib/presence/types";
import type { VoiceAction } from "./types";

export interface ExecDeps {
  user: { uid: string; displayName: string; email: string };
  router: { push: (href: string) => void; back?: () => void };
  projects: { id: string; name: string }[];
  currentProjectId: string | null;
  currentDocId: string | null;
}

const SECTION_ROUTES: Record<string, string> = {
  projects: "/projects",
  research: "/research",
  calendar: "/calendar",
  tempo: "/calendar/tempo",
  goals: "/calendar/goals",
  habits: "/calendar/habits",
  integrations: "/calendar/integrations",
  invariants: "/calendar/compiler/invariants",
  teams: "/teams",
  activity: "/activity",
  settings: "/settings",
  preview: "/preview",
  home: "/projects",
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function toHtml(content: string): string {
  return content
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .filter((p) => p !== "<p></p>")
    .join("");
}
function resolveProjectId(name: string | undefined, deps: ExecDeps, created: Map<string, string>): string | null {
  if (!name) return null;
  const key = name.trim().toLowerCase();
  return created.get(key) ?? deps.projects.find((p) => p.name.trim().toLowerCase() === key)?.id ?? null;
}
function awaitDecision(id: string): Promise<ConfirmationDecision> {
  return new Promise((resolve) => {
    const unsub = usePresenceStore.subscribe((s) => {
      if (s.lastResolved && s.lastResolved.id === id) {
        unsub();
        resolve(s.lastResolved.decision);
      }
    });
  });
}
/** Reach client-only UI (command palette, theme, doc panels) via a bridge event. */
function dispatchUi(detail: Record<string, unknown>) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("aria:ui", { detail }));
}
function navTo(route: string, label: string, deps: ExecDeps): void {
  const p = usePresenceStore.getState();
  const id = p.startAction({ label: `Opening ${label}`, phase: "navigating" });
  // Walk the ghost to the matching sidebar anchor and "click" it before the
  // route actually changes. If no anchor is mounted the choreographer parks at
  // screen-center — either way the navigation fires at the click beat. Runs
  // detached so navTo keeps its void signature (callers don't await).
  void choreographClick(`nav:${route}`, label, () => deps.router.push(route)).then(
    () => p.finishAction(id, "done"),
    () => p.finishAction(id, "failed"),
  );
}
function track(label: string, phase: "executing", fn: () => Promise<void>): Promise<void> {
  const p = usePresenceStore.getState();
  const id = p.startAction({ label, phase });
  p.setPhase(phase);
  return fn().then(
    () => p.finishAction(id, "done"),
    () => {
      p.finishAction(id, "failed");
      p.fail(`${label} failed.`);
    },
  );
}

export async function executeDirective(
  action: VoiceAction,
  deps: ExecDeps,
  created: Map<string, string>,
): Promise<void> {
  const p = usePresenceStore.getState();

  switch (action.type) {
    /* ── navigation ── */
    case "navigate":
      navTo(SECTION_ROUTES[action.section] ?? "/projects", action.label ?? action.section, deps);
      return;
    case "go_back":
      deps.router.back?.();
      return;
    case "open_project": {
      const pid = action.projectId ?? resolveProjectId(action.name, deps, created);
      if (!pid) return void p.fail("I couldn't find that project.");
      navTo(`/project/${pid}`, action.name ?? "project", deps);
      return;
    }
    case "open_project_graph": {
      const pid = action.projectId ?? resolveProjectId(action.name, deps, created) ?? deps.currentProjectId;
      if (!pid) return void p.fail("Which project's graph?");
      navTo(`/project/${pid}/graph`, "graph", deps);
      return;
    }
    case "open_project_planner": {
      const pid = action.projectId ?? resolveProjectId(action.name, deps, created) ?? deps.currentProjectId;
      if (!pid) return void p.fail("Which project's planner?");
      navTo(`/project/${pid}/planner`, "planner", deps);
      return;
    }
    case "open_document": {
      const pid = action.projectId ?? deps.currentProjectId;
      if (!action.docId || !pid) return void p.fail("I couldn't locate that document.");
      navTo(`/project/${pid}/doc/${action.docId}`, action.title ?? "document", deps);
      return;
    }
    case "open_team": {
      if (!action.teamId) return navTo("/teams", "Teams", deps);
      navTo(`/teams/${action.teamId}`, action.name ?? "team", deps);
      return;
    }

    /* ── create ── */
    case "create_project":
      return track(`Creating "${action.name}"`, "executing", async () => {
        const pid = await createProject(deps.user.uid, { name: action.name, mode: "reasoning", systemInstructions: "" });
        created.set(action.name.trim().toLowerCase(), pid);
        deps.router.push(`/project/${pid}`);
      });
    case "create_document": {
      const pid = action.projectId ?? resolveProjectId(action.projectName, deps, created) ?? deps.currentProjectId;
      if (!pid) return void p.fail("I need a project to put that document in.");
      return track(`Creating "${action.title}"`, "executing", async () => {
        const docId = await createDocument(deps.user.uid, pid, action.title);
        // Hand the body to the doc page so it types it into the LIVE editor
        // (collab/Y.Doc-safe + visible) instead of pasting into Firestore.
        if (action.content) queueDocWrite(docId, action.content, "append");
        deps.router.push(`/project/${pid}/doc/${docId}`);
      });
    }
    case "create_team":
      return track(`Creating team "${action.name}"`, "executing", async () => {
        await createTeam(
          { uid: deps.user.uid, displayName: deps.user.displayName, email: deps.user.email },
          { name: action.name, description: "" },
        );
        deps.router.push("/teams");
      });
    case "create_event":
    case "create_task":
      navTo("/calendar?new=1", "new event", deps);
      return;
    case "create_goal":
      navTo("/calendar/goals?new=1", "new goal", deps);
      return;
    case "create_habit":
      navTo("/calendar/habits?new=1", "new habit", deps);
      return;

    /* ── edit ── */
    case "edit_document": {
      const docId = action.docId ?? deps.currentDocId;
      // If it's the doc the user is looking at, edit the LIVE editor (collab-safe).
      if (docId && docId === deps.currentDocId) {
        dispatchUi({ kind: "edit", mode: action.mode, content: action.content });
        const id = p.startAction({ label: "Editing the document", phase: "executing" });
        p.setPhase("executing");
        p.finishAction(id, "done");
        return;
      }
      if (!docId) return void p.fail("Which document should I edit?");
      return track("Editing the document", "executing", async () => {
        const existing = await getDocument(docId);
        const old = existing?.content ?? "";
        const fragment = toHtml(action.content);
        const next = action.mode === "replace" ? fragment : action.mode === "prepend" ? fragment + old : old + fragment;
        await updateDocument(docId, { content: next });
      });
    }
    case "rename": {
      if (action.kind === "document") {
        const docId = action.id ?? deps.currentDocId;
        if (!docId) return void p.fail("Which document should I rename?");
        return track(`Renaming to "${action.name}"`, "executing", async () => {
          await updateDocument(docId, { title: action.name });
        });
      }
      const pid = action.id ?? resolveProjectId(action.name, deps, created) ?? deps.currentProjectId;
      if (!pid) return void p.fail("Which project should I rename?");
      return track(`Renaming to "${action.name}"`, "executing", async () => {
        await updateProject(pid, { name: action.name });
      });
    }

    /* ── delete (confirmed) ── */
    case "delete": {
      const label = action.label ?? action.name ?? action.kind;
      const cid = p.requestConfirmation({
        summary: `Delete ${label}?`,
        risk: action.kind === "project" ? "critical" : "high",
        affected: [
          { id: action.id ?? "—", label, kind: action.kind === "document" ? "doc" : action.kind === "project" ? "project" : "other" },
        ],
        impact: "Reversible — restore from Trash.",
        undoable: true,
        autoDismissMs: 10000,
      });
      const decision = await awaitDecision(cid);
      if (decision !== "confirm") return void p.setPhase("idle");
      return track(`Deleting ${label}`, "executing", async () => {
        if (action.kind === "document" && action.id && action.projectId) await deleteDocument(action.id, action.projectId);
        else if (action.kind === "project") {
          const pid = action.id ?? resolveProjectId(action.name, deps, created);
          if (pid) await deleteProject(pid);
        } else if (action.kind === "team" && action.id) await deleteTeam(action.id);
      });
    }

    /* ── actions ── */
    case "search":
      navTo(`/research?ask=${encodeURIComponent(action.query)}`, "search", deps);
      return;
    case "ask":
      navTo(`/research?ask=${encodeURIComponent(action.question)}`, "Research", deps);
      return;
    case "tempo_plan":
      navTo("/calendar/tempo", "Tempo", deps);
      return;
    case "command_palette":
      dispatchUi({ kind: "command_palette" });
      return;
    case "set_theme":
      dispatchUi({ kind: "theme", theme: action.theme });
      return;
    case "toggle_doc_panel":
      dispatchUi({ kind: "doc_panel", panel: action.panel });
      return;

    /* ── conversational ── */
    case "answer":
    case "clarify":
    default:
      return;
  }
}
