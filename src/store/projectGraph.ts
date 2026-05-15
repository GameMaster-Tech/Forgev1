import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/* ───────────────────────────────────────────────────────────────
   Types — mirror graph page
   ─────────────────────────────────────────────────────────────── */

export type GraphNodeType = "paper" | "topic" | "concept";

export interface StoredGraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  // Paper metadata
  authors?: string[];
  doi?: string;
  journal?: string;
  year?: number;
  verified?: boolean;
  citationCount?: number;
  abstract?: string;
  url?: string;
  // Provenance
  queryId?: string;
  createdAt: number;
}

export interface StoredGraphEdge {
  id: string;
  source: string;
  target: string;
  strength: number;
  createdAt: number;
}

export interface ProjectGraph {
  nodes: StoredGraphNode[];
  edges: StoredGraphEdge[];
}

interface ProjectGraphState {
  // Keyed by projectId
  graphs: Record<string, ProjectGraph>;

  getGraph: (projectId: string) => ProjectGraph;
  addNode: (projectId: string, node: Omit<StoredGraphNode, "id" | "createdAt"> & { id?: string }) => string;
  updateNode: (projectId: string, nodeId: string, updates: Partial<StoredGraphNode>) => void;
  deleteNode: (projectId: string, nodeId: string) => void;
  addEdge: (projectId: string, source: string, target: string, strength?: number) => string | null;
  deleteEdge: (projectId: string, edgeId: string) => void;
  ingestResearch: (
    projectId: string,
    query: string,
    sources: Array<{
      title: string;
      url?: string;
      author?: string;
      doi?: string;
      journal?: string;
      year?: number;
      verified?: boolean;
      text?: string;
    }>,
  ) => void;
  clearGraph: (projectId: string) => void;
}

const EMPTY_GRAPH: ProjectGraph = { nodes: [], edges: [] };

function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function findOrCreateTopic(
  nodes: StoredGraphNode[],
  label: string,
  queryId: string,
): { nodes: StoredGraphNode[]; topicId: string } {
  const normalized = label.trim().toLowerCase();
  const existing = nodes.find(
    (n) => n.type === "topic" && n.label.trim().toLowerCase() === normalized,
  );
  if (existing) return { nodes, topicId: existing.id };

  const topic: StoredGraphNode = {
    id: genId("t"),
    type: "topic",
    label: label.trim(),
    queryId,
    createdAt: Date.now(),
  };
  return { nodes: [...nodes, topic], topicId: topic.id };
}

export const useProjectGraphStore = create<ProjectGraphState>()(
  persist(
    (set, get) => ({
      graphs: {},

      getGraph: (projectId) => get().graphs[projectId] ?? EMPTY_GRAPH,

      addNode: (projectId, node) => {
        const id = node.id ?? genId(node.type === "paper" ? "p" : node.type === "topic" ? "t" : "c");
        set((state) => {
          const graph = state.graphs[projectId] ?? EMPTY_GRAPH;
          const newNode: StoredGraphNode = {
            ...node,
            id,
            createdAt: Date.now(),
          };
          return {
            graphs: {
              ...state.graphs,
              [projectId]: {
                nodes: [...graph.nodes, newNode],
                edges: graph.edges,
              },
            },
          };
        });
        return id;
      },

      updateNode: (projectId, nodeId, updates) => {
        set((state) => {
          const graph = state.graphs[projectId];
          if (!graph) return state;
          return {
            graphs: {
              ...state.graphs,
              [projectId]: {
                ...graph,
                nodes: graph.nodes.map((n) =>
                  n.id === nodeId ? { ...n, ...updates, id: n.id } : n,
                ),
              },
            },
          };
        });
      },

      deleteNode: (projectId, nodeId) => {
        set((state) => {
          const graph = state.graphs[projectId];
          if (!graph) return state;
          return {
            graphs: {
              ...state.graphs,
              [projectId]: {
                nodes: graph.nodes.filter((n) => n.id !== nodeId),
                edges: graph.edges.filter(
                  (e) => e.source !== nodeId && e.target !== nodeId,
                ),
              },
            },
          };
        });
      },

      addEdge: (projectId, source, target, strength = 0.7) => {
        if (source === target) return null;
        let newId: string | null = null;
        set((state) => {
          const graph = state.graphs[projectId] ?? EMPTY_GRAPH;
          const exists = graph.edges.find(
            (e) =>
              (e.source === source && e.target === target) ||
              (e.source === target && e.target === source),
          );
          if (exists) {
            newId = exists.id;
            return state;
          }
          const id = genId("e");
          newId = id;
          const edge: StoredGraphEdge = {
            id,
            source,
            target,
            strength,
            createdAt: Date.now(),
          };
          return {
            graphs: {
              ...state.graphs,
              [projectId]: {
                nodes: graph.nodes,
                edges: [...graph.edges, edge],
              },
            },
          };
        });
        return newId;
      },

      deleteEdge: (projectId, edgeId) => {
        set((state) => {
          const graph = state.graphs[projectId];
          if (!graph) return state;
          return {
            graphs: {
              ...state.graphs,
              [projectId]: {
                ...graph,
                edges: graph.edges.filter((e) => e.id !== edgeId),
              },
            },
          };
        });
      },

      ingestResearch: (projectId, query, sources) => {
        if (!query.trim() || sources.length === 0) return;
        const queryId = genId("q");
        const now = Date.now();

        set((state) => {
          const graph = state.graphs[projectId] ?? EMPTY_GRAPH;
          let nodes = [...graph.nodes];
          const edges = [...graph.edges];

          // 1. Topic node from query (first ~40 chars)
          const topicLabel =
            query.length > 42 ? query.slice(0, 40).trim() + "…" : query.trim();
          const topicResult = findOrCreateTopic(nodes, topicLabel, queryId);
          nodes = topicResult.nodes;
          const topicId = topicResult.topicId;

          // 2. Paper nodes per source (dedupe by DOI, falling back to title)
          sources.forEach((src, idx) => {
            if (!src.title) return;
            const titleKey = src.title.trim().toLowerCase();
            const doiKey = src.doi?.trim().toLowerCase();

            const existingIdx = nodes.findIndex((n) => {
              if (n.type !== "paper") return false;
              const nDoi = n.doi?.trim().toLowerCase();
              const nTitle = n.label.trim().toLowerCase();
              if (doiKey && nDoi && doiKey === nDoi) return true;
              return nTitle === titleKey;
            });

            let paperId: string;
            if (existingIdx >= 0) {
              // Enrich existing paper with new verified metadata
              const existing = nodes[existingIdx];
              nodes[existingIdx] = {
                ...existing,
                doi: src.doi ?? existing.doi,
                journal: src.journal ?? existing.journal,
                year: src.year ?? existing.year,
                verified: src.verified ?? existing.verified,
                authors: src.author
                  ? existing.authors
                    ? Array.from(new Set([...existing.authors, src.author]))
                    : [src.author]
                  : existing.authors,
                url: src.url ?? existing.url,
                abstract: existing.abstract ?? src.text?.slice(0, 400),
              };
              paperId = existing.id;
            } else {
              paperId = genId("p");
              nodes.push({
                id: paperId,
                type: "paper",
                label: src.title,
                authors: src.author ? [src.author] : undefined,
                doi: src.doi,
                journal: src.journal,
                year: src.year,
                verified: src.verified,
                url: src.url,
                abstract: src.text?.slice(0, 400),
                queryId,
                createdAt: now + idx,
              });
            }

            // Edge: topic → paper
            const edgeExists = edges.find(
              (e) =>
                (e.source === topicId && e.target === paperId) ||
                (e.source === paperId && e.target === topicId),
            );
            if (!edgeExists) {
              edges.push({
                id: genId("e"),
                source: topicId,
                target: paperId,
                strength: 0.85,
                createdAt: now + idx,
              });
            }
          });

          return {
            graphs: {
              ...state.graphs,
              [projectId]: { nodes, edges },
            },
          };
        });
      },

      clearGraph: (projectId) => {
        set((state) => ({
          graphs: {
            ...state.graphs,
            [projectId]: EMPTY_GRAPH,
          },
        }));
      },
    }),
    {
      name: "forge-project-graphs",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
