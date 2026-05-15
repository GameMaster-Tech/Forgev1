import { create } from "zustand";
import {
  createProject as fbCreateProject,
  getUserProjects,
  updateProject as fbUpdateProject,
  deleteProject as fbDeleteProject,
  type FirestoreProject,
} from "@/lib/firebase/firestore";

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
    const id = await fbCreateProject(userId, data);
    // Optimistically add to local state
    const now = Date.now();
    set((state) => ({
      projects: [
        {
          id,
          name: data.name,
          mode: data.mode,
          systemInstructions: data.systemInstructions,
          createdAt: now,
          updatedAt: now,
          queryCount: 0,
          docCount: 0,
          status: "active",
        },
        ...state.projects,
      ],
    }));
    return id;
  },

  updateProject: async (id, updates) => {
    await fbUpdateProject(id, updates);
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === id ? { ...p, ...updates, updatedAt: Date.now() } : p
      ),
    }));
  },

  deleteProject: async (id) => {
    await fbDeleteProject(id);
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
    }));
  },

  getProject: (id) => get().projects.find((p) => p.id === id),

  reset: () => set({ projects: [], loading: false, loaded: false, error: null }),
}));
