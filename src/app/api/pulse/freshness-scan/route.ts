/**
 * POST /api/pulse/freshness-scan
 *
 * Stateless Groq proxy for the project-wide freshness check. Client
 * sends the docs it wants checked; this route normalises + calls
 * Groq + parses the response.
 *
 * Same shape and discipline as `/api/forge-graph/project-contradictions`:
 *   • Any non-empty corpus → Groq is called.
 *   • Every request logs a request line and the Groq round-trip so
 *     you can watch calls land in real time.
 *   • Verbatim-substring validation drops hallucinated spans.
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

const SYSTEM_PROMPT = `You are Forge's freshness scanner. Read every numbered document and surface every claim that reads as TIME-SENSITIVE — anything a careful reader should re-verify before relying on it today.

Examples of stale-prone claims:
  • Dated milestones: "We ship on April 3rd."
  • "Current" claims: "Our pricing is $99/mo."
  • Market or competitive snapshots.
  • Demographic / population figures.
  • Software version pins.
  • Headcount / org-state claims.

What does NOT count:
  • Conceptual or definitional statements.
  • Reasoning, motivation, or strategy that doesn't reference a moving fact.
  • Hypotheticals.

Today's date is ${new Date().toISOString().slice(0, 10)}. Treat anything older than ~6 months as worth flagging if it's the kind of thing that drifts.

Respond with STRICT JSON only — no prose, no markdown — matching:
{
  "items": [
    {
      "docIndex": <integer doc index>,
      "span": "<verbatim sentence copied from the document>",
      "category": "<one of: dated, pricing, market, demographics, version, headcount, other>",
      "reason": "<one short sentence on why this is time-sensitive, ≤ 25 words>",
      "severity": "<one of: low, medium, high>"
    }
  ]
}

Rules:
- docIndex MUST be one of the indices from the list.
- span MUST be a verbatim substring of the referenced doc.
- Cap at 12 items; pick the most clearly drift-prone.
- Return { "items": [] } when nothing is flagged.`;

interface RawItem {
  docIndex?: unknown;
  span?: unknown;
  category?: unknown;
  reason?: unknown;
  severity?: unknown;
}

interface InputDoc {
  id?: unknown;
  title?: unknown;
  content?: unknown;
}

export interface FreshnessItem {
  docId: string;
  docTitle: string;
  span: string;
  category: "dated" | "pricing" | "market" | "demographics" | "version" | "headcount" | "other";
  reason: string;
  severity: "low" | "medium" | "high";
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

const CATEGORIES = new Set([
  "dated",
  "pricing",
  "market",
  "demographics",
  "version",
  "headcount",
  "other",
]);
const SEVERITIES = new Set(["low", "medium", "high"]);

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (isAuthFailure(auth)) return auth;

  const rl = enforceRateLimit(
    request,
    { routeId: "pulse.freshness-scan", ...RATE_LIMIT_EXPENSIVE },
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
    `[freshness] ← POST uid=${auth.uid} project=${projectId} incomingDocs=${rawDocs.length}`,
  );

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
    `[freshness] normalised: usableDocs=${docs.length} totalTextChars=${total}`,
  );

  if (docs.length === 0) {
    return Response.json({
      items: [],
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
      maxCompletionTokens: 2000,
      temperature: 0.15,
      jsonResponse: true,
      timeoutMs: 25_000,
    });

    const items = parsePayload(result.content, docs);
    console.log(
      `[freshness] ✓ Groq returned ${items.length} item${items.length === 1 ? "" : "s"}`,
    );

    return Response.json({
      items,
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
    console.error(`[freshness] ✗ Groq call failed (${status}) — ${message}`);
    return Response.json(
      {
        items: [],
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

function parsePayload(raw: string, docs: NormalizedDoc[]): FreshnessItem[] {
  if (!raw) return [];
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  let parsed: { items?: RawItem[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.warn("[freshness] JSON parse failed on Groq response:", cleaned.slice(0, 200));
    return [];
  }
  const list = Array.isArray(parsed.items) ? parsed.items : [];
  const byIdx = new Map(docs.map((d) => [d.index, d] as const));
  const out: FreshnessItem[] = [];
  for (const c of list.slice(0, 12)) {
    const doc = byIdx.get(Number(c.docIndex));
    if (!doc) continue;
    const span = typeof c.span === "string" ? c.span.trim() : "";
    const reason = typeof c.reason === "string" ? c.reason.trim().slice(0, 200) : "";
    const category =
      typeof c.category === "string" && CATEGORIES.has(c.category)
        ? (c.category as FreshnessItem["category"])
        : "other";
    const severity =
      typeof c.severity === "string" && SEVERITIES.has(c.severity)
        ? (c.severity as FreshnessItem["severity"])
        : "medium";
    if (!span) continue;
    if (!doc.text.toLowerCase().includes(span.toLowerCase())) continue;
    out.push({
      docId: doc.id,
      docTitle: doc.title,
      span,
      category,
      reason,
      severity,
    });
  }
  return out;
}
