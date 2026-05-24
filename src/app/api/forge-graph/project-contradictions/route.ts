/**
 * POST /api/forge-graph/project-contradictions
 *
 * Stateless Groq proxy for the project-wide AI contradiction scan.
 * The client sends the docs it wants checked; this route normalises
 * + calls Groq + parses the response.
 *
 * Critical behaviour:
 *   • If the client sends ≥ 1 non-empty doc, Groq IS called. Period.
 *     No "min total chars" gate — that was masking the actual call
 *     and making the Groq console look empty.
 *   • Every request logs to stderr: how many docs, total chars,
 *     Groq round-trip, parsed pair count. Watch `next dev`'s terminal
 *     to see calls land in real time.
 *   • The model is asked for STRICT JSON; we parse, validate that
 *     each spanA/spanB is a verbatim substring of its source, and
 *     drop hallucinations.
 *
 * Body:
 *   { projectId: string; docs: [{ id, title, content }] }
 *
 * Response:
 *   { contradictions: ProjectContradiction[], scannedDocs: number,
 *     groq?: { model, durationMs, tokens: {in,out} } }
 */

import { isAuthFailure, requireUser } from "@/lib/server/api-auth";
import {
  enforceRateLimit,
  identifyClient,
  rateLimitResponse,
  RATE_LIMIT_EXPENSIVE,
} from "@/lib/server/rate-limit";
import { DEFAULT_MODEL, groqChat, GroqApiError } from "@/lib/ai/groq";

const MAX_DOCS = 20;
const PER_DOC_CHARS = 6_000;
const MAX_TOTAL_CHARS = 40_000;

const SYSTEM_PROMPT = `You are Forge's project-wide contradiction scanner. You receive a numbered list of documents from the same project. Your job: find every pair of statements (across or within docs) that DIRECTLY CONTRADICT each other.

A contradiction means: a reasonable reader would conclude both statements cannot simultaneously be true. Examples that qualify:
  • "[1] The deadline is May 12." vs "[3] We ship on June 1."
  • "[2] Our team is fully remote." vs "[2] All meetings happen in the SF office."
  • Numerical facts that are plainly inconsistent across docs.
  • Date / pricing / headcount / scope claims that disagree.

The following do NOT qualify:
  • Paraphrases or restatements.
  • Topic-adjacent statements that don't actually contradict.
  • Hedged statements ("X may be true").
  • Different scopes / time-frames where both can be true.

Respond with STRICT JSON only — no prose, no markdown — matching:
{
  "contradictions": [
    {
      "docA": <integer doc index>,
      "docB": <integer doc index>,
      "spanA": "<verbatim sentence copied from docA>",
      "spanB": "<verbatim sentence copied from docB>",
      "reason": "<one short sentence, ≤ 25 words>"
    }
  ]
}

Rules:
- docA / docB MUST be one of the indices in the supplied list.
- spanA MUST be a verbatim substring of docA; spanB MUST be a verbatim substring of docB. Copy exactly.
- Cap at 8 contradictions; pick the most clear-cut.
- Return { "contradictions": [] } when nothing genuinely contradicts.`;

interface RawContradiction {
  docA?: unknown;
  docB?: unknown;
  spanA?: unknown;
  spanB?: unknown;
  reason?: unknown;
}

interface InputDoc {
  id?: unknown;
  title?: unknown;
  content?: unknown;
}

export interface ProjectContradiction {
  docAId: string;
  docATitle: string;
  docBId: string;
  docBTitle: string;
  spanA: string;
  spanB: string;
  reason: string;
}

interface RequestBody {
  projectId?: unknown;
  docs?: unknown;
}

interface NormalizedDoc {
  index: number;
  id: string;
  title: string;
  text: string;
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (isAuthFailure(auth)) return auth;

  const rl = enforceRateLimit(
    request,
    { routeId: "forge-graph.project-contradictions", ...RATE_LIMIT_EXPENSIVE },
    identifyClient(request, auth.uid),
  );
  if (!rl.ok) return rateLimitResponse(rl);

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawDocs = Array.isArray(body.docs) ? (body.docs as InputDoc[]) : [];
  const projectId = typeof body.projectId === "string" ? body.projectId : "(unknown)";

  console.log(
    `[contradictions] ← POST uid=${auth.uid} project=${projectId} incomingDocs=${rawDocs.length}`,
  );

  // Normalise + cap. Strip HTML, truncate per-doc, stop once we hit
  // the global budget so the model context stays bounded.
  const docs: NormalizedDoc[] = [];
  let total = 0;
  for (const raw of rawDocs.slice(0, MAX_DOCS)) {
    const id = typeof raw.id === "string" ? raw.id : "";
    if (!id) continue;
    const title = typeof raw.title === "string" ? raw.title.slice(0, 120) : "Untitled";
    const text = htmlToText(typeof raw.content === "string" ? raw.content : "")
      .slice(0, PER_DOC_CHARS);
    if (!text.trim()) continue;
    docs.push({ index: docs.length + 1, id, title, text });
    total += text.length;
    if (total >= MAX_TOTAL_CHARS) break;
  }

  console.log(
    `[contradictions] normalised: usableDocs=${docs.length} totalTextChars=${total}`,
  );

  if (docs.length === 0) {
    // Nothing to look at — return a clean result so the UI can render
    // "no contradictions" honestly. We do NOT bill Groq for an empty
    // corpus.
    return Response.json({
      contradictions: [],
      scannedDocs: 0,
      note: "No documents with text content to scan.",
    });
  }

  const corpus = docs
    .map((d) => `[${d.index}] ${d.title}\n"""${d.text}"""`)
    .join("\n\n");

  try {
    const result = await groqChat({
      model: DEFAULT_MODEL,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `${corpus}\n\nRespond with JSON only.`,
        },
      ],
      maxCompletionTokens: 1500,
      temperature: 0.12,
      jsonResponse: true,
      timeoutMs: 25_000,
    });

    const contradictions = parsePayload(result.content, docs);
    console.log(
      `[contradictions] ✓ Groq returned ${contradictions.length} pair${contradictions.length === 1 ? "" : "s"} (raw content ${result.content.length} chars)`,
    );

    return Response.json({
      contradictions,
      scannedDocs: docs.length,
      groq: {
        model: result.model,
        durationMs: result.durationMs,
        tokens: { in: result.tokenUsage.input, out: result.tokenUsage.output },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    const status = err instanceof GroqApiError ? err.status : 0;
    console.error(`[contradictions] ✗ Groq call failed (${status}) — ${message}`);
    return Response.json(
      {
        contradictions: [],
        scannedDocs: docs.length,
        error: `Upstream: ${message}`,
      },
      { status: 502 },
    );
  }
}

/* ─────────────────────────── helpers ─────────────────────────── */

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/(p|div|li|h1|h2|h3|h4|h5|h6|blockquote|pre|br)>/gi, ". ")
    .replace(/<br\s*\/?\s*>/gi, ". ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePayload(raw: string, docs: NormalizedDoc[]): ProjectContradiction[] {
  if (!raw) return [];
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  let parsed: { contradictions?: RawContradiction[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.warn("[contradictions] JSON parse failed on Groq response:", cleaned.slice(0, 200));
    return [];
  }
  const list = Array.isArray(parsed.contradictions) ? parsed.contradictions : [];
  const byIdx = new Map(docs.map((d) => [d.index, d] as const));
  const out: ProjectContradiction[] = [];
  for (const c of list.slice(0, 8)) {
    const docA = byIdx.get(Number(c.docA));
    const docB = byIdx.get(Number(c.docB));
    if (!docA || !docB) continue;
    const spanA = typeof c.spanA === "string" ? c.spanA.trim() : "";
    const spanB = typeof c.spanB === "string" ? c.spanB.trim() : "";
    const reason = typeof c.reason === "string" ? c.reason.trim().slice(0, 200) : "";
    if (!spanA || !spanB) continue;
    if (
      !docA.text.toLowerCase().includes(spanA.toLowerCase()) ||
      !docB.text.toLowerCase().includes(spanB.toLowerCase())
    ) {
      continue;
    }
    out.push({
      docAId: docA.id,
      docATitle: docA.title,
      docBId: docB.id,
      docBTitle: docB.title,
      spanA,
      spanB,
      reason,
    });
  }
  return out;
}
