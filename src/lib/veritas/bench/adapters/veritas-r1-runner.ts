/**
 * VeritasR1BenchRunner — production BenchRunner for Forge's in-house model.
 *
 * Veritas-R1 is served behind an OpenAI-compatible HTTP endpoint (vLLM /
 * SGLang `POST /v1/chat/completions`). The same wire shape works on Modal,
 * Together, Fireworks, RunPod, or self-hosted vLLM, so the runner only needs
 * a `baseUrl` + `apiKey` + `model` to talk to any of them.
 *
 * Why we picked OpenAI-compat (and not the Anthropic shape):
 *   • vLLM, SGLang, and every open-weight serving stack expose this shape
 *     out of the box. No glue code on the serving side.
 *   • The Forge web app can also speak to local/dev endpoints via this same
 *     contract (Ollama, LM Studio, etc.) without code changes.
 *
 * Until Veritas-R1 finishes Phase 3/4 training, the endpoint will not exist.
 * The runner is wired LIVE (no mock fallback) — calling `run()` against an
 * unconfigured `baseUrl` throws a labelled error so CI surfaces the missing
 * deployment immediately rather than silently scoring zero.
 *
 * Bench responses are extracted from a single JSON-only completion. The
 * runner retries once on JSON-parse failure with a "JSON only" reminder
 * appended to the user message; persistent malformation is bubbled up to
 * the grader (which marks the task `malformed: true` and scores 0).
 */

import type {
  BenchResponse,
  BenchRunner,
  BenchSuiteId,
  BenchTask,
  ContraDetectResponse,
  MemoryRecallResponse,
  ReasoningChainResponse,
  ConversationResponse,
  CitationResponse,
  AbstentionResponse,
} from "../types";

export interface VeritasR1BenchRunnerOptions {
  /** Base URL of the OpenAI-compatible endpoint (e.g. https://veritas.modal.run/v1). */
  baseUrl?: string;
  /** Bearer token for the endpoint. Optional for local dev (Ollama / vLLM unauthenticated). */
  apiKey?: string;
  /** Model id to send (e.g. "veritas-r1-chat-14b" or "veritas-r1-mini-3b"). */
  model?: string;
  /** Output cap. Defaults to 2048. */
  maxTokens?: number;
  /** 0..2 — Veritas-R1 sampling temperature. Defaults to 0.2 for deterministic grading. */
  temperature?: number;
  /** System preamble. Defaults to a verification-first instruction. */
  system?: string;
  /** Inject a custom fetch — used by the integration test to stub transport. */
  fetchImpl?: typeof fetch;
  /** Wall-clock cap per request, in ms. Defaults to 60s. */
  timeoutMs?: number;
}

const DEFAULT_SYSTEM = [
  "You are Veritas-R1, Forge's verification-first research assistant.",
  "Ground every answer in the provided claims, episodes, and contradictions.",
  "Prefer abstention to fabrication when evidence is insufficient.",
  "Return a single JSON object that matches the suite response contract — no prose, no markdown fences.",
].join(" ");

const DEFAULT_TIMEOUT_MS = 60_000;

export class VeritasR1BenchRunner implements BenchRunner {
  readonly modelId: string;
  private readonly baseUrl?: string;
  private readonly apiKey?: string;
  private readonly maxTokens: number;
  private readonly temperature: number;
  private readonly system: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: VeritasR1BenchRunnerOptions = {}) {
    this.modelId = opts.model ?? "veritas-r1-chat-14b";
    this.baseUrl = opts.baseUrl?.replace(/\/$/, "");
    this.apiKey = opts.apiKey;
    this.maxTokens = opts.maxTokens ?? 2048;
    this.temperature = opts.temperature ?? 0.2;
    this.system = opts.system ?? DEFAULT_SYSTEM;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Render the task into the (system, user) pair sent to the model.
   * Exposed so tests and dashboards can inspect the exact prompt without
   * invoking transport.
   */
  renderPrompt(task: BenchTask): { system: string; user: string } {
    const contextBlock = renderContext(task);
    const suiteHint = renderSuiteHint(task.suite);
    const user = [
      `Suite: ${task.suite}`,
      `Task: ${task.title}`,
      "",
      contextBlock,
      "",
      `Prompt: ${task.prompt}`,
      "",
      suiteHint,
    ].join("\n");
    return { system: this.system, user };
  }

  async run(task: BenchTask): Promise<BenchResponse> {
    if (!this.baseUrl) {
      throw new Error(
        "VeritasR1BenchRunner: baseUrl not configured. Set the deployed " +
          "Veritas-R1 endpoint (vLLM / SGLang / Modal) before running benchmarks.",
      );
    }

    const { system, user } = this.renderPrompt(task);
    const raw = await this.callOnce(system, user);
    const parsed = tryExtractJson(raw);
    if (parsed) {
      const coerced = coerceToBenchResponse(task.suite, parsed);
      if (coerced) return coerced;
    }

    // Single retry with an explicit JSON-only nudge — model may have emitted
    // prose despite the system instruction. We do NOT retry indefinitely:
    // a second failure should surface as `malformed` so error analysis can
    // see the raw output rather than masking it with infinite retries.
    const retryUser =
      user +
      "\n\nReturn ONLY a single JSON object matching the suite contract above. No prose, no markdown.";
    const rawRetry = await this.callOnce(system, retryUser);
    const parsedRetry = tryExtractJson(rawRetry);
    if (parsedRetry) {
      const coerced = coerceToBenchResponse(task.suite, parsedRetry);
      if (coerced) return coerced;
    }

    throw new Error(
      `VeritasR1BenchRunner: model returned unparsable output for ` +
        `task=${task.id} suite=${task.suite}. First 200 chars: ${raw.slice(0, 200)}`,
    );
  }

  private async callOnce(system: string, user: string): Promise<string> {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

      const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: this.modelId,
          temperature: this.temperature,
          max_tokens: this.maxTokens,
          // OpenAI-style messages list; vLLM / SGLang / Together / Modal all accept this shape.
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          // Force a JSON response when the server supports it (vLLM ≥ 0.6, SGLang).
          // Servers that ignore the field still return a valid completion.
          response_format: { type: "json_object" },
        }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const body = await safeReadText(res);
        throw new Error(
          `VeritasR1BenchRunner: HTTP ${res.status} from ${this.baseUrl}: ${body.slice(0, 200)}`,
        );
      }

      const data = (await res.json()) as ChatCompletionResponse;
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new Error(
          "VeritasR1BenchRunner: response missing choices[0].message.content",
        );
      }
      return content;
    } finally {
      clearTimeout(timeout);
    }
  }
}

/* ─────────────────────────────────────────────────────────────
 *  HTTP / wire shape — minimal subset of the OpenAI chat schema
 * ──────────────────────────────────────────────────────────── */

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { role: string; content?: string };
    finish_reason?: string;
  }>;
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

/* ─────────────────────────────────────────────────────────────
 *  Prompt rendering — deterministic, mirrors what the integration
 *  test inspects via `renderPrompt`
 * ──────────────────────────────────────────────────────────── */

function renderContext(task: BenchTask): string {
  const { context } = task;
  const parts: string[] = [];
  if (context.projectBrief) parts.push(`Project brief: ${context.projectBrief}`);
  if (context.claims.length) {
    parts.push("Claims:");
    for (const c of context.claims) {
      parts.push(`  [${c.id}] ${c.atomicAssertion} (polarity=${c.polarity})`);
    }
  }
  if (context.contradictions.length) {
    parts.push("Known contradictions:");
    for (const cd of context.contradictions) {
      parts.push(
        `  ${cd.a} ⟷ ${cd.b} (${cd.signals.join("+") || "unspecified"}, ${cd.status})`,
      );
    }
  }
  if (context.episodes.length) {
    parts.push("Episodes (oldest → newest):");
    for (const e of context.episodes) {
      const digest = e.output ?? e.input;
      parts.push(`  [${e.id}] ${e.type} — ${truncate(digest, 120)}`);
    }
  }
  return parts.length ? parts.join("\n") : "(no context)";
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}

function renderSuiteHint(suite: BenchSuiteId): string {
  switch (suite) {
    case "contra-detect":
      return 'Return JSON: {"suite":"contra-detect","flaggedPairs":[[claimId,claimId],...]}';
    case "memory-recall":
      return 'Return JSON: {"suite":"memory-recall","citedClaimIds":[...],"answer":"..."}';
    case "reasoning-chain":
      return 'Return JSON: {"suite":"reasoning-chain","usedClaimIds":[...],"answer":"..."}';
    case "conversation":
      return 'Return JSON: {"suite":"conversation","answer":"...","citedClaimIds":[...]}';
    case "citation":
      return 'Return JSON: {"suite":"citation","doi":"10.xxxx/..."}';
    case "abstention":
      return 'Return JSON: {"suite":"abstention","abstained":true|false,"answer":"..."}';
  }
}

/* ─────────────────────────────────────────────────────────────
 *  JSON extraction + coercion
 * ──────────────────────────────────────────────────────────── */

function tryExtractJson(raw: string): unknown | null {
  const trimmed = raw.trim();
  // Direct parse first — happens when the server honours response_format.
  try {
    return JSON.parse(trimmed);
  } catch { /* fall through */ }

  // Handle ```json fenced blocks even though we asked for none.
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try { return JSON.parse(fence[1].trim()); } catch { /* fall through */ }
  }

  // Extract the largest brace-balanced span — defensive for prose-prefixed output.
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    try { return JSON.parse(trimmed.slice(first, last + 1)); } catch { /* fall through */ }
  }
  return null;
}

/**
 * Coerce a parsed JSON object into a typed BenchResponse for the requested
 * suite. We accept either:
 *   • the canonical shape `{suite, ...}` whose `suite` matches the task suite, OR
 *   • a "lenient" shape that omits `suite` but supplies the right fields,
 *     in which case we stamp the suite ourselves.
 *
 * Returns null if the shape is unrecoverably wrong — callers treat this as
 * a malformed response and the grader scores it 0.
 */
function coerceToBenchResponse(
  suite: BenchSuiteId,
  parsed: unknown,
): BenchResponse | null {
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  // If the model labelled a different suite, refuse — the grader contract is
  // suite-specific and silently swapping would distort scores.
  if (typeof obj.suite === "string" && obj.suite !== suite) return null;

  switch (suite) {
    case "contra-detect": {
      const flagged = Array.isArray(obj.flaggedPairs) ? obj.flaggedPairs : null;
      if (!flagged) return null;
      const pairs: Array<[string, string]> = [];
      for (const p of flagged) {
        if (Array.isArray(p) && p.length >= 2 && typeof p[0] === "string" && typeof p[1] === "string") {
          pairs.push([p[0], p[1]]);
        }
      }
      const out: ContraDetectResponse = { suite: "contra-detect", flaggedPairs: pairs };
      if (obj.rationales && typeof obj.rationales === "object") {
        out.rationales = obj.rationales as Record<string, string>;
      }
      return out;
    }
    case "memory-recall": {
      const citedClaimIds = stringArray(obj.citedClaimIds);
      const answer = typeof obj.answer === "string" ? obj.answer : "";
      const out: MemoryRecallResponse = {
        suite: "memory-recall",
        citedClaimIds,
        answer,
      };
      const eps = stringArray(obj.citedEpisodeIds);
      if (eps.length) out.citedEpisodeIds = eps;
      return out;
    }
    case "reasoning-chain": {
      const out: ReasoningChainResponse = {
        suite: "reasoning-chain",
        usedClaimIds: stringArray(obj.usedClaimIds),
        answer: typeof obj.answer === "string" ? obj.answer : "",
      };
      return out;
    }
    case "conversation": {
      const out: ConversationResponse = {
        suite: "conversation",
        answer: typeof obj.answer === "string" ? obj.answer : "",
      };
      const cited = stringArray(obj.citedClaimIds);
      if (cited.length) out.citedClaimIds = cited;
      return out;
    }
    case "citation": {
      const doi = typeof obj.doi === "string" ? obj.doi : "";
      if (!doi) return null;
      const out: CitationResponse = { suite: "citation", doi: doi.toLowerCase() };
      return out;
    }
    case "abstention": {
      const abstained =
        typeof obj.abstained === "boolean"
          ? obj.abstained
          : String(obj.abstained ?? "").toLowerCase() === "true";
      const out: AbstentionResponse = {
        suite: "abstention",
        abstained,
        answer: typeof obj.answer === "string" ? obj.answer : "",
      };
      return out;
    }
  }
}

function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) if (typeof x === "string") out.push(x);
  return out;
}
