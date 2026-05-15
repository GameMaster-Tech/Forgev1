import { create } from "zustand";

export interface Source {
  title: string;
  url: string;
  text?: string;
  highlights?: string[];
  publishedDate?: string;
  author?: string;
  // Verification
  verified?: boolean;
  doi?: string;
  journal?: string;
  year?: number;
  verifying?: boolean;
}

export interface ResearchMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  timestamp: number;
}

interface ResearchState {
  messages: ResearchMessage[];
  loading: boolean;
  currentQuery: string;

  setCurrentQuery: (query: string) => void;
  addMessage: (message: Omit<ResearchMessage, "id" | "timestamp">) => void;
  setLoading: (loading: boolean) => void;
  updateSource: (messageId: string, sourceIndex: number, updates: Partial<Source>) => void;
  clearMessages: () => void;
}

export const useResearchStore = create<ResearchState>((set) => ({
  messages: [],
  loading: false,
  currentQuery: "",

  setCurrentQuery: (query) => set({ currentQuery: query }),

  addMessage: (message) =>
    set((state) => ({
      messages: [
        ...state.messages,
        {
          ...message,
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          timestamp: Date.now(),
        },
      ],
    })),

  setLoading: (loading) => set({ loading }),

  updateSource: (messageId, sourceIndex, updates) =>
    set((state) => ({
      messages: state.messages.map((msg) => {
        if (msg.id !== messageId || !msg.sources) return msg;
        const newSources = [...msg.sources];
        newSources[sourceIndex] = { ...newSources[sourceIndex], ...updates };
        return { ...msg, sources: newSources };
      }),
    })),

  clearMessages: () => set({ messages: [] }),
}));
