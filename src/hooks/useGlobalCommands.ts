"use client";

/**
 * useGlobalCommands — registers the always-on Cmd-K actions.
 *
 * Two source registrations:
 *   • `global.nav` — every top-level route shortcut, project-aware
 *     when an active project is resolvable.
 *   • `global.create` — quick-create actions matching the sidebar's
 *     + button: document, chat, event, project, table block.
 *
 * Both are registered with the existing palette infrastructure via
 * `useRegisterCommandSource`. Mounting this hook anywhere inside the
 * authed app shell keeps the palette useful from every route.
 */

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  useRegisterCommandSource,
  makeCommandId,
  type CommandItem,
} from "@/hooks/useCommandPalette";
import { useActiveProject } from "@/hooks/useActiveProject";
import { useProjectsStore } from "@/store/projects";

interface UseGlobalCommandsOptions {
  /** Triggered by the "New project" command. */
  onNewProject?: () => void;
}

export function useGlobalCommands(opts: UseGlobalCommandsOptions = {}) {
  const router = useRouter();
  const { projectId } = useActiveProject();
  const projects = useProjectsStore((s) => s.projects);

  const onNewProject = opts.onNewProject;

  /* ── Navigation actions ────────────────────────────────────── */

  const navItems = useMemo<CommandItem[]>(() => {
    const make = (
      id: string,
      label: string,
      href: string,
      keywords: string[] = [],
    ): CommandItem => ({
      id: makeCommandId("global.nav", id),
      kind: "action",
      label: `Go to ${label}`,
      subtitle: href,
      keywords: [label, ...keywords],
      action: () => router.push(href),
    });
    return [
      make("research", "Chat", "/research", ["ask", "ai", "conversation"]),
      make("projects", "Projects", "/projects", ["workspace"]),
      make("calendar", "Calendar", "/calendar", ["schedule", "time"]),
      make("preview", "Preview", "/preview", ["impact simulator", "what if"]),
      make("activity", "Activity", "/activity", ["history", "log"]),
      make("teams", "Teams", "/teams", ["collaborators"]),
      make("settings", "Settings", "/settings", ["account", "preferences"]),
      make("invariants", "Rules", "/calendar/compiler/invariants", [
        "invariants",
        "guardrails",
      ]),
    ];
  }, [router]);

  useRegisterCommandSource("global.nav", navItems);

  /* ── Quick-create actions ──────────────────────────────────── */

  const createItems = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [];

    items.push({
      id: makeCommandId("global.create", "chat"),
      kind: "action",
      label: "New chat",
      subtitle: "Start a fresh Forge conversation",
      keywords: ["chat", "ask", "research", "ai"],
      action: () => router.push("/research?new=1"),
    });

    items.push({
      id: makeCommandId("global.create", "event"),
      kind: "action",
      label: "New event",
      subtitle: "Drop something on the calendar",
      keywords: ["event", "meeting", "calendar"],
      action: () => router.push("/calendar?new=1"),
    });

    items.push({
      id: makeCommandId("global.create", "project"),
      kind: "action",
      label: "New project",
      subtitle: "Brand-new workspace",
      keywords: ["project", "workspace"],
      action: () => onNewProject?.(),
    });

    // Document creation routes to the active project's page so the
    // user can pick a title — falls back to /projects when no
    // project is selected.
    if (projectId) {
      items.push({
        id: makeCommandId("global.create", "document"),
        kind: "action",
        label: "New document",
        subtitle: "Start writing in this project",
        keywords: ["document", "doc", "write", "page"],
        action: () => router.push(`/project/${projectId}?new=document`),
      });
    } else {
      items.push({
        id: makeCommandId("global.create", "document"),
        kind: "action",
        label: "New document",
        subtitle: "Pick a project first",
        keywords: ["document", "doc", "write", "page"],
        action: () => router.push("/projects?new=document"),
      });
    }

    return items;
  }, [router, projectId, onNewProject]);

  useRegisterCommandSource("global.create", createItems);

  /* ── Project shortcuts ─────────────────────────────────────── */

  const projectItems = useMemo<CommandItem[]>(() => {
    if (projects.length === 0) return [];
    return projects.slice(0, 25).map((p) => ({
      id: makeCommandId("global.project", p.id),
      kind: "action",
      label: `Open ${p.name}`,
      subtitle: "Project",
      keywords: ["project", p.name, p.mode],
      action: () => router.push(`/project/${p.id}`),
      recencyAt: new Date(p.updatedAt).toISOString(),
    }));
  }, [projects, router]);

  useRegisterCommandSource("global.projects", projectItems);
}
