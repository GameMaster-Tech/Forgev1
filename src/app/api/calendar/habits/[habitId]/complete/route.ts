/**
 * POST /api/calendar/habits/[habitId]/complete
 *
 * Logs a habit completion for today (or the supplied date). Updates the
 * habit's `streak`/`lastCompletedAt` and emits a realtime event.
 *
 * Body (optional):
 *   { date?: "YYYY-MM-DD", durationMinutes?: number, note?: string }
 *
 * Idempotent — completing twice on the same date is collapsed by the
 * Firestore doc id (`{date}`).
 */

import { NextResponse, type NextRequest } from "next/server";
import { verifyRequest } from "@/lib/server/auth";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { computeStreak, type CompletionEntry } from "@/lib/scheduler/habit-log";
import { publishCalendarEvent } from "@/lib/server/realtime";
import type { Habit } from "@/lib/scheduler";
import { FieldValue } from "firebase-admin/firestore";

export async function POST(req: NextRequest, ctx: { params: Promise<{ habitId: string }> }): Promise<Response> {
  const user = await verifyRequest(req);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { habitId } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { date?: string; durationMinutes?: number; note?: string };

  const fs = getAdminFirestore();
  const habitRef = fs.doc(`users/${user.uid}/calendar/habits/${habitId}`);
  const habitSnap = await habitRef.get();
  if (!habitSnap.exists) return NextResponse.json({ error: "habit not found" }, { status: 404 });
  const habit = habitSnap.data() as Habit;
  if (habit.archivedAt) return NextResponse.json({ error: "habit archived" }, { status: 410 });

  const date = body.date ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "bad date" }, { status: 400 });

  const completionsCol = habitRef.collection("completions");
  const entry: CompletionEntry = {
    date,
    at: Date.now(),
    durationMinutes: body.durationMinutes,
    note: body.note?.slice(0, 280),
  };
  await completionsCol.doc(date).set(entry, { merge: true });

  // Recompute streak by reading the full history. Bounded since
  // habits rarely have >2 years of data; if we ever do, paginate +
  // cache.
  const allSnap = await completionsCol.orderBy("date", "desc").limit(800).get();
  const all = allSnap.docs.map((d) => d.data() as CompletionEntry);
  const result = computeStreak(habit, all);

  await habitRef.set({
    streak: result.streak,
    lastCompletedAt: new Date(entry.at).toISOString(),
    updatedAt: FieldValue.serverTimestamp(),
  } as Partial<Habit>, { merge: true });

  await publishCalendarEvent(user.uid, { kind: "habit.completed", at: Date.now(), habitId, streak: result.streak });

  return NextResponse.json({ ok: true, streak: result });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ habitId: string }> }): Promise<Response> {
  const user = await verifyRequest(req);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { habitId } = await ctx.params;
  const date = req.nextUrl.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "bad date" }, { status: 400 });

  const fs = getAdminFirestore();
  const habitRef = fs.doc(`users/${user.uid}/calendar/habits/${habitId}`);
  const completionsCol = habitRef.collection("completions");
  await completionsCol.doc(date).delete();

  const allSnap = await completionsCol.orderBy("date", "desc").limit(800).get();
  const all = allSnap.docs.map((d) => d.data() as CompletionEntry);
  const habit = (await habitRef.get()).data() as Habit;
  const result = computeStreak(habit, all);
  await habitRef.set({ streak: result.streak } as Partial<Habit>, { merge: true });

  await publishCalendarEvent(user.uid, { kind: "habit.completed", at: Date.now(), habitId, streak: result.streak });
  return NextResponse.json({ ok: true, streak: result });
}
