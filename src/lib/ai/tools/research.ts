/**
 * Research tools — let the model run the same EXA-backed search the
 * /research surface uses. Two flavours:
 *
 *   • research_search   — neural web search, returns top results
 *                         (title, url, snippet) for citation work.
 *   • research_answer   — EXA's "answer" mode: a synthesised summary
 *                         with inline source links. Use for facts /
 *                         current-event lookups.
 *
 * Tools call EXA directly so the agent stays self-contained — no
 * extra hop through /api/research.
 */

import "server-only";
import Exa from "exa-js";
import type { Tool } from "./types";
import { toolError } from "./types";

let exaClient: Exa | null = null;
function getExa(): Exa | null {
  if (exaClient) return exaClient;
  const key = process.env.EXA_API_KEY;
  if (!key) return null;
  exaClient = new Exa(key);
  return exaClient;
}

interface SearchHit {
  title?: string | null;
  url?: string;
  text?: string;
  publishedDate?: string;
  author?: string | null;
  highlights?: string[];
}

interface ExaSearchResponse {
  results?: SearchHit[];
}

interface ExaAnswerResponse {
  answer?: string;
  citations?: Array<{ url?: string; title?: string }>;
}

const search: Tool = {
  name: "research_search",
  category: "research",
  definition: {
    type: "function",
    function: {
      name: "research_search",
      description:
        "Run a neural web search for the user's query. Returns the top results with title, url, and a snippet. Use when the user asks something that depends on live or external information.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query." },
          numResults: { type: "number", description: "How many hits to return (default 6, max 12)." },
          includeText: {
            type: "boolean",
            description: "If true, also returns a short text snippet per hit.",
          },
        },
        required: ["query"],
      },
    },
  },
  handler: async (args) => {
    const exa = getExa();
    if (!exa) return toolError("EXA_API_KEY not configured");
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) return toolError("query is required");
    const num = Math.min(typeof args.numResults === "number" ? args.numResults : 6, 12);
    const includeText = args.includeText !== false;
    try {
      const data = (await exa.search(query, {
        numResults: num,
        ...(includeText ? { text: { maxCharacters: 600 } } : {}),
        useAutoprompt: true,
      })) as ExaSearchResponse;
      const results = (data.results ?? []).map((r) => ({
        title: r.title ?? null,
        url: r.url ?? "",
        snippet: includeText ? (r.text ?? "").slice(0, 600) : undefined,
        publishedDate: r.publishedDate,
        author: r.author ?? null,
      }));
      return { query, count: results.length, results };
    } catch (err) {
      return toolError(
        err instanceof Error ? err.message : "Search failed",
      );
    }
  },
};

const answer: Tool = {
  name: "research_answer",
  category: "research",
  definition: {
    type: "function",
    function: {
      name: "research_answer",
      description:
        "Ask EXA to synthesize an answer with sources for a factual question. Returns a short answer + citations.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string" },
        },
        required: ["question"],
      },
    },
  },
  handler: async (args) => {
    const exa = getExa();
    if (!exa) return toolError("EXA_API_KEY not configured");
    const question = typeof args.question === "string" ? args.question.trim() : "";
    if (!question) return toolError("question is required");
    try {
      const data = (await exa.answer(question, { text: true })) as ExaAnswerResponse;
      return {
        question,
        answer: data.answer ?? "",
        sources: (data.citations ?? []).slice(0, 8).map((c) => ({
          title: c.title ?? null,
          url: c.url ?? "",
        })),
      };
    } catch (err) {
      return toolError(
        err instanceof Error ? err.message : "Answer failed",
      );
    }
  },
};

export const RESEARCH_TOOLS: Tool[] = [search, answer];
