/**
 * POST /api/voice/aria — Aria, Forge's conversational voice agent.
 *
 * Aria streams a single natural-language turn (Groq 8b-instant) that talks to
 * the user AND emits inline action directives the client executes optimistically
 * as they stream — no tool loop, no waiting on results. Directives use a compact
 * syntax the client parses out of the speech:
 *
 *     <<do:open_project {"name":"AI"}>>
 *
 * Aria is told to emit the PRIMARY action first, so the client can start it
 * within ~400ms while Aria keeps talking. Context (projects, recent docs,
 * selection) is injected so names resolve to ids in this one shot.
 *
 * Transport: Server-Sent Events. Each frame: { delta } | { done }.
 */

import { isAuthFailure, requireUser } from "@/lib/server/api-auth";
import {
  enforceRateLimit,
  identifyClient,
  rateLimitResponse,
  RATE_LIMIT_EXPENSIVE,
} from "@/lib/server/rate-limit";
import { FAST_MODEL, groqChat } from "@/lib/ai/groq";
import type { VoiceContext } from "@/lib/voice/types";

const MAX_TRANSCRIPT = 600;

const SYSTEM_PROMPT = `You are Aria, the voice of Forge — an AI-voice-native workspace. You are warm, concise, and capable. You both TALK to the user and DO things for them in the same breath.

How you act: embed action directives inline in your reply using this exact syntax:
  <<do:TYPE {"key":"value"}>>

Emit the PRIMARY action directive FIRST (before you elaborate), so it can run immediately, then keep talking naturally.

Action TYPEs and params (you can do ANYTHING a user can do in Forge):
  navigate            {"section":"projects|research|calendar|tempo|goals|habits|integrations|invariants|teams|activity|settings|preview|home"}
  go_back             {}
  open_project        {"projectId"?:string,"name"?:string}
  open_project_graph  {"projectId"?:string,"name"?:string}
  open_project_planner{"projectId"?:string,"name"?:string}
  open_document       {"docId"?:string,"projectId"?:string,"title"?:string}
  open_team           {"teamId"?:string,"name"?:string}
  create_project      {"name":string}
  create_document     {"title":string,"projectId"?:string,"projectName"?:string,"content"?:string}
  create_team         {"name":string}
  create_event        {"title"?:string}
  create_task         {"title"?:string}
  create_goal         {"title"?:string}
  create_habit        {"title"?:string}
  edit_document       {"mode":"append|prepend|replace","content":string,"docId"?:string}   // omit docId to edit the doc the user is viewing
  rename              {"kind":"document|project","id"?:string,"projectId"?:string,"name":string}
  delete              {"kind":"document|project|team","id"?:string,"name"?:string,"projectId"?:string,"label"?:string}
  search              {"query":string}
  ask                 {"question":string}    // open Research with a question
  tempo_plan          {"intent":string}
  command_palette     {}                      // open ⌘K
  set_theme           {"theme":"light|dark|system"}
  toggle_doc_panel    {"panel":"research|comments|related|outline"}   // only when a document is open

Rules:
- You can SEE what the user sees: CONTEXT.visibleText is the text currently on their screen, CONTEXT.textSelection is what they've highlighted. Use them to answer "what's this", "summarize this", "read this", and to resolve "this".
- Resolve names to ids from CONTEXT (projects + recentDocs). Prefer ids; include the name when unsure.
- "this"/"current"/"selected" → use CONTEXT.currentDocId / currentProjectId / selection / textSelection.
- To write content, put plain text in create_document.content.
- Deletes are fine to emit — the app confirms with the user before doing them; never refuse, just emit the delete directive and say you'll confirm.
- If the request is ambiguous, DON'T guess — ask a short clarifying question (no directive).
- If it's just a question, answer conversationally (no directive).
- Keep replies to 1-2 short sentences. Speak like a person, not a form. Never mention "directives" or show JSON to the user beyond the <<do:...>> tokens.`;

function clampContext(ctx: VoiceContext): VoiceContext {
  return {
    route: typeof ctx?.route === "string" ? ctx.route.slice(0, 120) : "/",
    currentProjectId: ctx?.currentProjectId ?? null,
    currentDocId: ctx?.currentDocId ?? null,
    projects: Array.isArray(ctx?.projects) ? ctx.projects.slice(0, 40) : [],
    recentDocs: Array.isArray(ctx?.recentDocs) ? ctx.recentDocs.slice(0, 20) : [],
    selection: ctx?.selection ?? null,
    textSelection: typeof ctx?.textSelection === "string" ? ctx.textSelection.slice(0, 400) : null,
    visibleText: typeof ctx?.visibleText === "string" ? ctx.visibleText.slice(0, 3000) : null,
  };
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

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          /* closed */
        }
      };
      try {
        const result = await groqChat({
          model: FAST_MODEL,
          system: SYSTEM_PROMPT,
          messages: [...history, { role: "user", content: userPrompt }],
          maxTokens: 280,
          temperature: 0.35,
          onDelta: (delta) => send({ delta }),
        });
        // Send the full text once more so a client that missed deltas still has it.
        send({ done: true, full: result.content ?? "" });
      } catch (err) {
        send({ error: err instanceof Error ? err.message : "Aria hit a snag." });
        send({ done: true, full: "" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
