"use client";

/**
 * useActiveProject — single source of truth for "which project is the
 * current screen attached to."
 *
 * Resolution order:
 *   1. Project id from the URL when the user is on a /project/[id]/*
 *      or any sub-route that names a project.
 *   2. Last-active id from localStorage (`forge.activeProject.v1`).
 *   3. First project in the user's list.
 *   4. `null` — no project. UI should render its empty state.
 *
 * Picking a project from a selector elsewhere should call
 * `setActiveProject(id)` which writes to localStorage and emits a
 * window-level event so every mounted hook re-resolves immediately.
 */

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useProjectsStore } from "@/store/projects";

const STORAGE_KEY = "forge.activeProject.v1";
const EVENT_NAME = "forge.activeProject.changed";

function readStored(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* localStorage disabled — read fallback will return null next time */
  }
}

/** Parse the active project from the URL when one is encoded. */
function projectIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/project\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function setActiveProject(id: string | null): void {
  writeStored(id);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: id }));
  }
}

export interface UseActiveProjectApi {
  /** Active project id, or null when no project is resolvable. */
  projectId: string | null;
  /** Convenience setter — also persists to localStorage. */
  setProjectId: (id: string | null) => void;
  /** True while the projects store hasn't completed its first load. */
  loading: boolean;
}

export function useActiveProject(): UseActiveProjectApi {
  const pathname = usePathname();
  const projects = useProjectsStore((s) => s.projects);
  const loaded = useProjectsStore((s) => s.loaded);
  const loading = useProjectsStore((s) => s.loading);

  const [stored, setStored] = useState<string | null>(() => readStored());

  // Listen for cross-hook updates so every consumer stays in sync.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string | null>).detail ?? null;
      setStored(detail);
    };
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, []);

  const fromUrl = projectIdFromPath(pathname ?? "");

  // Pick the best available id. URL wins, then stored, then the
  // first-in-list. If the stored id doesn't appear in the user's
  // projects (deleted, moved teams, etc.) treat it as null.
  let projectId: string | null = null;
  if (fromUrl) {
    projectId = fromUrl;
  } else if (stored && projects.some((p) => p.id === stored)) {
    projectId = stored;
  } else if (loaded && projects.length > 0) {
    projectId = projects[0].id;
  }

  return {
    projectId,
    loading: !loaded && loading,
    setProjectId: setActiveProject,
  };
}
