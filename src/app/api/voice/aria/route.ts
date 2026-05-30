/**
 * POST /api/voice/aria — Aria, Forge's conversational voice agent.
 *
 * Aria returns a single STRUCTURED JSON envelope:
 *
 *     { "speech": "<what she says aloud>", "actions": [ { "type": ..., ... } ] }
 *
 * Speech and actions are separate fields, so an action can never leak into the
 * spoken text (the old inline-`<<do:>>`-in-prose contract was unreliable on an
 * 8B model — directives got spoken instead of executed). Groq JSON mode forces
 * valid structure; the client executes `actions` deterministically and speaks
 * `speech`. One round-trip, no tool loop.
 */

import { isAuthFailure, requireUser } from "@/lib/server/api-auth";
import {
  enforceRateLimit,
  identifyClient,
  rateLimitResponse,
  RATE_LIMIT_EXPENSIVE,
} from "@/lib/server/rate-limit";
import { FAST_MODEL, groqChat } from "@/lib/ai/groq";
import { ALL_ACTION_TYPES, type VoiceContext } from "@/lib/voice/types";

const MAX_TRANSCRIPT = 600;
const ACTION_SET = new Set<string>(ALL_ACTION_TYPES);

const SYSTEM_PROMPT = `You are Aria, the voice of Forge — an AI-voice-native workspace. You are warm, concise, and capable: you TALK to the user AND DO things for them.

Respond with ONLY a single JSON object — no prose, no markdown, nothing around it:
{"speech":"<one or two short sentences you say out loud>","actions":[ <zero or more action objects> ]}

Rules:
- "speech" is natural spoken language. NEVER put action names, JSON, code, ids, or <<>> tokens in speech.
- "actions" is the ORDERED list of things to do. Use [] for a pure answer or a clarifying question.
- Resolve names → ids from CONTEXT (projects + recentDocs). Prefer ids; include "name"/"title" when unsure.
- "this"/"current"/"selected" → CONTEXT.currentDocId / currentProjectId / selection / textSelection.
- You can SEE the screen: CONTEXT.visibleText and CONTEXT.textSelection. Use them to answer "what's this", "summarize this", "read this".
- Times: CONTEXT.now is the current ISO time and CONTEXT.timeZone the user's zone — compute ISO "start"/"end" from phrases like "tomorrow at 3pm".
- Deletes are fine — the app confirms before doing them. Emit the delete and say you'll confirm.
- If ambiguous, ask a short clarifying question in "speech" with "actions":[].

Each action = {"type":<TYPE>, ...params}. TYPEs:
  navigate {"section":"projects|research|calendar|tempo|goals|habits|integrations|invariants|teams|activity|settings|preview|home"}
  go_back {}
  open_project {"projectId"?,"name"?}
  open_project_graph {"projectId"?,"name"?}
  open_project_planner {"projectId"?,"name"?}
  open_document {"docId"?,"projectId"?,"title"?}
  open_last {}
  open_team {"teamId"?,"name"?}
  create_project {"name"}
  create_document {"title","projectId"?,"projectName"?,"content"?}
  create_team {"name"}
  seed_workspace {"name"?}
  create_event {"title","start"?(ISO),"end"?(ISO),"allDay"?,"kind"?:"meeting|deadline|focus|personal"}
  create_task {"title","due"?(ISO)}
  create_goal {"title","targetDate"?(ISO),"successCriteria"?}
  create_habit {"title","rrule"?}
  edit_document {"mode":"append|prepend|replace","content","docId"?}
  rename {"kind":"document|project","id"?,"projectId"?,"name"}
  delete {"kind":"document|project|team","id"?,"name"?,"projectId"?,"label"?}
  search {"query"}
  ask {"question"}
  tempo_plan {"intent"}
  command_palette {}
  set_theme {"theme":"light|dark|system"}
  toggle_doc_panel {"panel":"research|comments|related|outline"}

Examples:
  "open the AI project" -> {"speech":"Opening the AI project.","actions":[{"type":"open_project","name":"AI"}]}
  "go to my calendar" -> {"speech":"Here's your calendar.","actions":[{"type":"navigate","section":"calendar"}]}
  "add a meeting tomorrow at 3pm" -> {"speech":"Added it to your calendar.","actions":[{"type":"create_event","title":"Meeting","start":"<ISO>","end":"<ISO>","kind":"meeting"}]}
  "make a goal to ship v2 by August" -> {"speech":"Goal created.","actions":[{"type":"create_goal","title":"Ship v2","targetDate":"<ISO>"}]}
  "what's on screen?" -> {"speech":"<short summary of CONTEXT.visibleText>","actions":[]}`;

interface ClampedContext extends VoiceContext {
  now: string;
  timeZone: string;
}

function clampContext(ctx: VoiceContext): ClampedContext {
  return {
    route: typeof ctx?.route === "string" ? ctx.route.slice(0, 120) : "/",
    currentProjectId: ctx?.currentProjectId ?? null,
    currentDocId: ctx?.currentDocId ?? null,
    projects: Array.isArray(ctx?.projects) ? ctx.projects.slice(0, 40) : [],
    recentDocs: Array.isArray(ctx?.recentDocs) ? ctx.recentDocs.slice(0, 20) : [],
    selection: ctx?.selection ?? null,
    textSelection: typeof ctx?.textSelection === "string" ? ctx.textSelection.slice(0, 400) : null,
    visibleText: typeof ctx?.visibleText === "string" ? ctx.visibleText.slice(0, 3000) : null,
    now: typeof ctx?.now === "string" ? ctx.now : new Date().toISOString(),
    timeZone: typeof ctx?.timeZone === "string" ? ctx.timeZone.slice(0, 60) : "UTC",
  };
}

interface AriaEnvelope {
  speech: string;
  actions: Record<string, unknown>[];
}

/** Parse the model's JSON envelope, tolerating stray prose/fences, and keep
 *  only actions whose `type` we recognize. */
function parseEnvelope(content: string): AriaEnvelope {
  const raw = content.trim();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Salvage the first {...} block if the model wrapped it in prose/fences.
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        parsed = JSON.parse(m[0]);
      } catch {
        /* give up — speak the raw text */
      }
    }
  }
  if (!parsed || typeof parsed !== "object") {
    return { speech: raw.slice(0, 400), actions: [] };
  }
  const obj = parsed as { speech?: unknown; actions?: unknown };
  const speech = typeof obj.speech === "string" ? obj.speech : "";
  const actions = Array.isArray(obj.actions)
    ? obj.actions.filter(
        (a): a is Record<string, unknown> =>
          !!a && typeof a === "object" && typeof (a as { type?: unknown }).type === "string" && ACTION_SET.has((a as { type: string }).type),
      )
    : [];
  return { speech, actions };
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireUser(request);
  if (isAuthFailure(auth)) return auth;

  const rl = enforceRateLimit(
    request,
    { routeId: "voice.aria", ...RATE_LIMIT_EXPENSIVE },
    identifyClient(request, auth.uid),
  );
  if (!rl.ok) return rateLimitResponse(rl);

  let body: { transcript?: unknown; context?: unknown; history?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const transcript = typeof body.transcript === "string" ? body.transcript.trim().slice(0, MAX_TRANSCRIPT) : "";
  if (!transcript) return Response.json({ error: "transcript required" }, { status: 400 });
  const context = clampContext((body.context ?? {}) as VoiceContext);

  const history = Array.isArray(body.history)
    ? (body.history as { role?: unknown; content?: unknown }[])
        .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .slice(-6)
        .map((m) => ({ role: m.role as "user" | "assistant", content: (m.content as string).slice(0, 1000) }))
    : [];

  const userPrompt = `CONTEXT:\n${JSON.stringify(context)}\n\nUSER SAID:\n${transcript}`;

  try {
    const result = await groqChat({
      model: FAST_MODEL,
      system: SYSTEM_PROMPT,
      messages: [...history, { role: "user", content: userPrompt }],
      maxTokens: 500,
      temperature: 0.2,
      jsonResponse: true,
    });
    const envelope = parseEnvelope(result.content ?? "");
    return Response.json(envelope, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Aria hit a snag.", speech: "", actions: [] },
      { status: 200 },
    );
  }
}
