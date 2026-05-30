import { create } from "zustand";
import {
  createProject as fbCreateProject,
  getUserProjects,
  updateProject as fbUpdateProject,
  deleteProject as fbDeleteProject,
  type FirestoreProject,
} from "@/lib/firebase/firestore";
import { toastSuccess, toastError } from "@/lib/toast";

export type ResearchMode = "lightning" | "reasoning" | "deep";

export interface Project {
  id: string;
  name: string;
  mode: ResearchMode;
  systemInstructions: string;
  createdAt: number;
  updatedAt: number;
  queryCount: number;
  docCount: number;
  status: "active" | "archived";
}

interface ProjectsState {
  projects: Project[];
  loading: boolean;
  loaded: boolean;
  error: string | null;

  fetchProjects: (userId: string) => Promise<void>;
  addProject: (
    userId: string,
    project: { name: string; mode: ResearchMode; systemInstructions: string }
  ) => Promise<string>;
  updateProject: (id: string, updates: Partial<Pick<Project, "name" | "mode" | "systemInstructions" | "queryCount" | "docCount" | "status">>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  getProject: (id: string) => Project | undefined;
  reset: () => void;
}

function toProject(fp: FirestoreProject): Project {
  return {
    id: fp.id,
    name: fp.name,
    mode: fp.mode,
    systemInstructions: fp.systemInstructions,
    createdAt: fp.createdAt?.toMillis?.() ?? Date.now(),
    updatedAt: fp.updatedAt?.toMillis?.() ?? Date.now(),
    queryCount: fp.queryCount,
    docCount: fp.docCount,
    status: fp.status,
  };
}

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  projects: [],
  loading: false,
  loaded: false,
  error: null,

  fetchProjects: async (userId: string) => {
    if (get().loaded || get().loading) return;
    set({ loading: true, error: null });
    try {
      const docs = await getUserProjects(userId);
      set({ projects: docs.map(toProject), loaded: true, error: null });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to load projects right now.";
      set({ error: message, loaded: false });
      console.warn("Failed to fetch projects:", message);
    } finally {
      set({ loading: false });
    }
  },

  addProject: async (userId, data) => {
    // Optimistic: drop a temp row in immediately, reconcile its id once the
    // write lands, and roll it back out if the write fails.
    const now = Date.now();
    const tempId = `temp-${now}-${Math.random().toString(36).slice(2, 7)}`;
    const optimistic: Project = {
      id: tempId,
      name: data.name,
      mode: data.mode,
      systemInstructions: data.systemInstructions,
      createdAt: now,
      updatedAt: now,
      queryCount: 0,
      docCount: 0,
      status: "active",
    };
    set((state) => ({ projects: [optimistic, ...state.projects] }));
    try {
      const id = await fbCreateProject(userId, data);
      set((state) => ({
        projects: state.projects.map((p) =>
          p.id === tempId ? { ...p, id } : p,
        ),
      }));
      return id;
    } catch (err) {
      // Reconcile: remove the temp row so the list reflects reality. The
      // caller (e.g. NewProjectModal) surfaces the failure inline; we
      // rethrow so its control flow stays intact.
      set((state) => ({
        projects: state.projects.filter((p) => p.id !== tempId),
      }));
      throw err;
    }
  },

  updateProject: async (id, updates) => {
    // Optimistic: apply locally first, keep a snapshot to roll back to.
    const prev = get().projects.find((p) => p.id === id);
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === id ? { ...p, ...updates, updatedAt: Date.now() } : p,
      ),
    }));
    try {
      await fbUpdateProject(id, updates);
      if (updates.name) toastSuccess("Project renamed", updates.name);
      else if (updates.status === "archived") toastSuccess("Project archived");
    } catch (err) {
      if (prev) {
        set((state) => ({
          projects: state.projects.map((p) => (p.id === id ? prev : p)),
        }));
      }
      toastError(err, "Couldn't save your changes.");
      throw err;
    }
  },

  deleteProject: async (id) => {
    // Optimistic: pull the row immediately, restore it if the delete fails.
    const prev = get().projects;
    const removed = prev.find((p) => p.id === id);
    set({ projects: prev.filter((p) => p.id !== id) });
    try {
      await fbDeleteProject(id);
      toastSuccess("Project deleted", removed?.name);
    } catch (err) {
      set({ projects: prev });
      toastError(err, "Couldn't delete the project.");
      throw err;
    }
  },

  getProject: (id) => get().projects.find((p) => p.id === id),

  reset: () => set({ projects: [], loading: false, loaded: false, error: null }),
}));
