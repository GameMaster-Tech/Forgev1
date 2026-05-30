"use client";

/**
 * Aria executor — runs a single VoiceAction deterministically: router push, a
 * client Firestore SDK call, or (for deletes) a confirmation the user must
 * approve first. Every action drives the presence ghost cursor + trail so it's
 * visible. The hook calls this per-directive as Aria streams, sharing a
 * `created` map so "create project X then a doc in X" resolves the new id.
 */

import {
  createDocument,
  updateDocument,
  deleteDocument,
  createProject,
  deleteProject,
  createTeam,
  deleteTeam,
} from "@/lib/firebase/firestore";
import { usePresenceStore } from "@/store/presence";
import { resolveTargetId } from "@/lib/presence/spatial";
import type { ConfirmationDecision, PresenceTarget } from "@/lib/presence/types";
import type { VoiceAction } from "./types";

export interface ExecDeps {
  user: { uid: string; displayName: string; email: string };
  router: { push: (href: string) => void };
  projects: { id: string; name: string }[];
  currentProjectId: string | null;
}

const SECTION_ROUTES: Record<string, string> = {
  projects: "/projects",
  research: "/research",
  calendar: "/calendar",
  tempo: "/calendar/tempo",
  teams: "/teams",
  activity: "/activity",
  settings: "/settings",
  home: "/projects",
};

function centerRect(): PresenceTarget["rect"] {
  const w = typeof window !== "undefined" ? window.innerWidth : 1280;
  const h = typeof window !== "undefined" ? window.innerHeight : 800;
  return { x: w / 2 - 12, y: h / 2 - 12, width: 24, height: 24 };
}

function routeTarget(route: string, label?: string): PresenceTarget {
  return resolveTargetId(`nav:${route}`) ?? { id: `route:${route}`, label, kind: "nav", rect: centerRect() };
}

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

function resolveProjectId(
  name: string | undefined,
  deps: ExecDeps,
  created: Map<string, string>,
): string | null {
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

function navTo(route: string, label: string, deps: ExecDeps) {
  const p = usePresenceStore.getState();
  p.setPhase("navigating");
  p.setTarget(routeTarget(route, label));
  const id = p.startAction({ label: `Opening ${label}`, phase: "navigating" });
  deps.router.push(route);
  p.finishAction(id, "done");
}

export async function executeDirective(
  action: VoiceAction,
  deps: ExecDeps,
  created: Map<string, string>,
): Promise<void> {
  const p = usePresenceStore.getState();

  switch (action.type) {
    case "navigate":
      navTo(SECTION_ROUTES[action.section] ?? "/projects", action.label ?? action.section, deps);
      return;

    case "open_project": {
      const pid = action.projectId ?? resolveProjectId(action.name, deps, created);
      if (!pid) {
        p.fail("I couldn't find that project.");
        return;
      }
      navTo(`/project/${pid}`, action.name ?? "project", deps);
      return;
    }

    case "open_document": {
      const pid = action.projectId ?? deps.currentProjectId;
      if (!action.docId || !pid) {
        p.fail("I couldn't locate that document.");
        return;
      }
      navTo(`/project/${pid}/doc/${action.docId}`, action.title ?? "document", deps);
      return;
    }

    case "create_project": {
      const aid = p.startAction({ label: `Creating "${action.name}"`, phase: "executing" });
      p.setPhase("executing");
      try {
        const pid = await createProject(deps.user.uid, {
          name: action.name,
          mode: "reasoning",
          systemInstructions: "",
        });
        created.set(action.name.trim().toLowerCase(), pid);
        p.finishAction(aid, "done");
        deps.router.push(`/project/${pid}`);
      } catch {
        p.finishAction(aid, "failed");
        p.fail("Couldn't create that project.");
      }
      return;
    }

    case "create_document": {
      const pid =
        action.projectId ?? resolveProjectId(action.projectName, deps, created) ?? deps.currentProjectId;
      if (!pid) {
        p.fail("I need a project to put that document in.");
        return;
      }
      const aid = p.startAction({ label: `Creating "${action.title}"`, phase: "executing" });
      p.setPhase("executing");
      try {
        const docId = await createDocument(deps.user.uid, pid, action.title);
        if (action.content) await updateDocument(docId, { content: toHtml(action.content) });
        p.finishAction(aid, "done");
        deps.router.push(`/project/${pid}/doc/${docId}`);
      } catch {
        p.finishAction(aid, "failed");
        p.fail("Couldn't create that document.");
      }
      return;
    }

    case "create_team": {
      const aid = p.startAction({ label: `Creating team "${action.name}"`, phase: "executing" });
      p.setPhase("executing");
      try {
        await createTeam(
          { uid: deps.user.uid, displayName: deps.user.displayName, email: deps.user.email },
          { name: action.name, description: "" },
        );
        p.finishAction(aid, "done");
        deps.router.push("/teams");
      } catch {
        p.finishAction(aid, "failed");
        p.fail("Couldn't create that team.");
      }
      return;
    }

    case "search":
      navTo(`/research?ask=${encodeURIComponent(action.query)}`, "search", deps);
      return;

    case "tempo_plan":
      navTo("/calendar/tempo", "Tempo", deps);
      return;

    case "delete": {
      const label = action.label ?? action.name ?? action.kind;
      const cid = p.requestConfirmation({
        summary: `Delete ${label}?`,
        risk: action.kind === "project" ? "critical" : "high",
        affected: [
          {
            id: action.id ?? "—",
            label,
            kind: action.kind === "document" ? "doc" : action.kind === "project" ? "project" : "other",
          },
        ],
        impact: "Reversible — restore from Trash.",
        undoable: true,
        autoDismissMs: 10000,
      });
      const decision = await awaitDecision(cid);
      if (decision !== "confirm") {
        p.setPhase("idle");
        return;
      }
      const aid = p.startAction({ label: `Deleting ${label}`, phase: "executing" });
      p.setPhase("executing");
      try {
        if (action.kind === "document" && action.id && action.projectId) {
          await deleteDocument(action.id, action.projectId);
        } else if (action.kind === "project") {
          const pid = action.id ?? resolveProjectId(action.name, deps, created);
          if (pid) await deleteProject(pid);
        } else if (action.kind === "team" && action.id) {
          await deleteTeam(action.id);
        }
        p.finishAction(aid, "done");
      } catch {
        p.finishAction(aid, "failed");
        p.fail("Couldn't delete that.");
      }
      return;
    }

    case "answer":
    case "clarify":
    default:
      // Aria speaks; nothing to execute.
      return;
  }
}
