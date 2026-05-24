/**
 * POST /api/tempo/agent
 *
 * The Tempo engine, powered by a Groq agent loop.
 *
 * Request body:
 *   {
 *     projectId: string,           // active project for scope binding
 *     intent:    string,           // user's free-form ask ("plan my week around the launch")
 *     horizonDays?: number,        // default 7
 *     previewOnly?: boolean        // when true, the system prompt tells the model
 *                                  // NOT to mutate state — just propose a plan as JSON
 *   }
 *
 * Response:
 *   {
 *     message: string,             // final natural-language summary
 *     plan:    StructuredPlan,     // typed plan extracted from the model's last turn
 *     steps:   AgentStep[],        // every tool the model invoked
 *     tokens:  { in, out, total },
 *     model:   string,
 *     durationMs: number
 *   }
 *
 * Tools exposed to the model:
 *   • calendar_list_events
 *   • calendar_create_event / update_event / delete_event
 *   • tasks_create / tasks_list / habits_create / goals_create
 *   • docs_list, docs_read              (so it can pull context from docs)
 *
 * Tools NOT exposed:
 *   • docs_create / docs_update         (writing is the writer's job, not Tempo's)
 *   • research_*                        (Tempo plans, doesn't browse)
 *
 * The system prompt requires the model to:
 *   1. Read the calendar BEFORE proposing changes.
 *   2. Surface every change as a structured diff (created / moved / deleted).
 *   3. Give a short rationale per change.
 *   4. End with a single JSON object summarising the plan so the UI can render diffs.
 */

import { NextResponse, type NextRequest } from "next/server";
import { isAuthFailure, requireUser } from "@/lib/server/api-auth";
import {
  enforceRateLimit,
  identifyClient,
  rateLimitResponse,
  RATE_LIMIT_EXPENSIVE,
} from "@/lib/server/rate-limit";
import { runAgent, type AgentStep } from "@/lib/ai/agent";
import { buildRegistry } from "@/lib/ai/tools/registry";
import { DEFAULT_MODEL } from "@/lib/ai/groq";

export const runtime = "nodejs";
export const maxDuration = 120;

interface RequestBody {
  projectId?: unknown;
  intent?: unknown;
  horizonDays?: unknown;
  previewOnly?: unknown;
}

export interface TempoPlanChange {
  kind: "create" | "update" | "delete";
  entity: "event" | "task" | "habit" | "goal";
  id?: string;
  title: string;
  start?: string;
  end?: string;
  rationale: string;
}

export interface TempoPlan {
  summary: string;
  changes: TempoPlanChange[];
  unresolved?: string[];
}

function buildSystemPrompt(args: {
  projectId: string;
  horizonDays: number;
  previewOnly: boolean;
}): string {
  const today = new Date().toISOString();
  return `You are Forge's Tempo scheduler. You operate the user's calendar with surgical precision.

CONTEXT
  • Today is ${today}.
  • Active project: ${args.projectId}.
  • Planning horizon: next ${args.horizonDays} day(s).
  • Mode: ${args.previewOnly ? "PREVIEW (do NOT mutate — propose only)" : "LIVE (you may call mutating tools)"}.

OPERATING DISCIPLINE
  1. ALWAYS call \`calendar_list_events\` for the planning horizon BEFORE proposing or making changes. Never schedule on top of an existing block.
  2. Use \`tasks_list\` and \`docs_list\` to ground yourself in what the user is working on — what's overdue, what's in flight, what context is needed.
  3. Prefer \`calendar_update_event\` over delete-then-create when re-scheduling. Updates preserve history.
  4. Cluster deep work in the morning (08:00–12:00 local), meetings midday, recovery in the late afternoon — unless the user's existing rhythm says otherwise.
  5. Never schedule >4h of deep work in a single contiguous block. Add a 15-min break.
  6. Each created or moved event MUST have a short \`description\` that names the goal it advances.

OUTPUT CONTRACT
After your tool calls are done, return a single message that is STRICT JSON with this shape:

{
  "summary": "<1–2 sentence narrative of what you planned and why>",
  "changes": [
    {
      "kind": "create" | "update" | "delete",
      "entity": "event" | "task" | "habit" | "goal",
      "id": "<id of created/updated/deleted entity if you have it>",
      "title": "<human title>",
      "start": "<ISO start if applicable>",
      "end": "<ISO end if applicable>",
      "rationale": "<one sentence explaining why this change advances the user's intent>"
    }
  ],
  "unresolved": [
    "<plain-English list of things you couldn't decide and need the user to clarify>"
  ]
}

Do not wrap the JSON in markdown fences. Do not add prose before or after it. The UI parses your final message as JSON to render the diff view.

If you couldn't make progress, return:
{ "summary": "Couldn't plan — see unresolved.", "changes": [], "unresolved": ["<reason>"] }`;
}

export async function POST(req: NextRequest): Promise<Response> {
  const auth = await requireUser(req);
  if (isAuthFailure(auth)) return auth;

  const rl = enforceRateLimit(
    req,
    { routeId: "tempo.agent", ...RATE_LIMIT_EXPENSIVE },
    identifyClient(req, auth.uid),
  );
  if (!rl.ok) return rateLimitResponse(rl);

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  const intent = typeof body.intent === "string" ? body.intent.trim() : "";
  const horizonDays =
    typeof body.horizonDays === "number" && body.horizonDays > 0
      ? Math.min(body.horizonDays, 30)
      : 7;
  const previewOnly = body.previewOnly !== false; // default to PREVIEW for safety

  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }
  if (!intent) {
    return NextResponse.json({ error: "intent required" }, { status: 400 });
  }

  // Build a tool registry scoped for scheduling.
  const registry = buildRegistry({
    groups: previewOnly
      ? ["calendar", "tasks", "docs:read"] // mutating tools still defined; the system prompt tells the model not to use them
      : ["calendar", "tasks", "docs:read"],
  });

  // Compose the agent run.
  console.log(
    `[tempo.agent] ← uid=${auth.uid} project=${projectId} previewOnly=${previewOnly} horizon=${horizonDays}d intent="${intent.slice(0, 120)}"`,
  );

  const result = await runAgent({
    system: buildSystemPrompt({ projectId, horizonDays, previewOnly }),
    messages: [{ role: "user", content: intent }],
    registry,
    ctx: { uid: auth.uid, projectId, startedAt: Date.now() },
    model: DEFAULT_MODEL,
    maxTurns: 6,
    temperature: 0.25,
    perCallTimeoutMs: 30_000,
  });

  const plan = parsePlan(result.message);

  console.log(
    `[tempo.agent] ✓ finish=${result.finishReason} steps=${result.steps.length} planChanges=${plan?.changes.length ?? 0} tokens=${result.tokens.total}`,
  );

  return NextResponse.json({
    message: result.message,
    plan,
    steps: simplifySteps(result.steps),
    tokens: result.tokens,
    model: result.model,
    durationMs: result.durationMs,
    finishReason: result.finishReason,
  });
}

function parsePlan(raw: string): TempoPlan | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as Partial<TempoPlan>;
    if (!parsed || typeof parsed !== "object") return null;
    const changes = Array.isArray(parsed.changes) ? parsed.changes : [];
    const safeChanges: TempoPlanChange[] = changes
      .filter(
        (c): c is TempoPlanChange =>
          !!c &&
          typeof c === "object" &&
          typeof c.title === "string" &&
          (c.kind === "create" || c.kind === "update" || c.kind === "delete"),
      )
      .slice(0, 30);
    return {
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      changes: safeChanges,
      unresolved: Array.isArray(parsed.unresolved)
        ? parsed.unresolved.filter((s): s is string => typeof s === "string").slice(0, 10)
        : [],
    };
  } catch {
    return null;
  }
}

function simplifySteps(steps: AgentStep[]) {
  return steps.map((s) => ({
    turn: s.turn,
    tool: s.tool,
    durationMs: s.durationMs,
    // Truncate large payloads for the wire — the full result is on
    // the server log.
    result: summarizeResult(s.result),
  }));
}

function summarizeResult(r: unknown): unknown {
  if (r == null) return r;
  if (typeof r !== "object") return r;
  const obj = r as Record<string, unknown>;
  if ("error" in obj) return { error: obj.error };
  // For list-shaped results, only return counts.
  for (const key of ["events", "tasks", "docs"]) {
    if (Array.isArray(obj[key])) {
      return { [`${key}Count`]: (obj[key] as unknown[]).length };
    }
  }
  return obj;
}
