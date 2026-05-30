/**
 * GET /api/voice/warm — pre-warm the voice path so the user's FIRST command
 * doesn't eat cold-start latency.
 *
 * The first real call to /api/voice/aria otherwise pays for: this route booting
 * (serverless cold start / dev compile), Groq's TLS handshake + system-CA load,
 * and the initial connection. We pay that here, once, on app load (the client
 * fires this a single time per session), with a 1-token throwaway completion.
 *
 * Best-effort: any failure is swallowed — the real call will surface errors.
 */

import { isAuthFailure, requireUser } from "@/lib/server/api-auth";
import { FAST_MODEL, groqChat } from "@/lib/ai/groq";

export async function GET(request: Request): Promise<Response> {
  const auth = await requireUser(request);
  if (isAuthFailure(auth)) return auth;

  let warmed = false;
  try {
    await groqChat({
      model: FAST_MODEL,
      system: "warm",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 1,
      temperature: 0,
      timeoutMs: 8000,
    });
    warmed = true;
  } catch {
    /* warm is best-effort — never fail the request */
  }

  return Response.json(
    { ok: true, warmed },
    { headers: { "Cache-Control": "no-store" } },
  );
}
