/**
 * GET /api/realtime/calendar
 *
 * Server-Sent-Events stream of `CalendarRealtimeEvent`s for the
 * authenticated user. Client connects via `EventSource` and the
 * connection lives until the tab closes or the server restarts; the
 * client hook reconnects with exponential backoff on close.
 *
 * Why SSE instead of WebSockets:
 *   • One-way (server → client) — sufficient for our model.
 *   • Works over plain HTTP, no upgrade handshake.
 *   • Browser auto-reconnect built in.
 *   • Plays well with Vercel / Cloud Run / Fly.
 */

import { type NextRequest } from "next/server";
import { verifyRequest } from "@/lib/server/auth";
import { subscribe, type CalendarRealtimeEvent } from "@/lib/server/realtime";
import { randomToken } from "@/lib/server/crypto";

// Bypass Next's default response caching for streams.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ENCODER = new TextEncoder();
const HEARTBEAT_MS = 25_000;

export async function GET(req: NextRequest): Promise<Response> {
  const user = await verifyRequest(req);
  if (!user) return new Response("unauthenticated", { status: 401 });
  const tabId = req.nextUrl.searchParams.get("tab") ?? randomToken(6);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (chunk: string) => {
        try { controller.enqueue(ENCODER.encode(chunk)); } catch {/* closed */}
      };
      const writeEvent = (ev: CalendarRealtimeEvent) => {
        enqueue(`event: ${ev.kind}\n`);
        enqueue(`data: ${JSON.stringify(ev)}\n\n`);
      };
      // Initial hello so EventSource fires `onopen`.
      enqueue("retry: 5000\n");
      enqueue(`: connected ${new Date().toISOString()}\n\n`);

      const unsub = subscribe({ uid: user.uid, tabId }, writeEvent);
      const heartbeat = setInterval(() => enqueue(`: ping ${Date.now()}\n\n`), HEARTBEAT_MS);

      // Cleanly tear down on disconnect.
      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsub();
        try { controller.close(); } catch {/* already closed */}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // disable nginx buffering
    },
  });
}
