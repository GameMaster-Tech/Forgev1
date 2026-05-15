/**
 * GET /api/calendar/habits/[habitId]/completions
 *   Returns the full completion history (newest first, capped at 365 days).
 *   Used by the streak chart in the Habit Log UI.
 *
 * Query:
 *   ?days=90   (1–365; default 90)
 */

import { NextResponse, type NextRequest } from "next/server";
import { verifyRequest } from "@/lib/server/auth";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { computeStreak, type CompletionEntry } from "@/lib/scheduler/habit-log";
import type { Habit } from "@/lib/scheduler";

export async function GET(req: NextRequest, ctx: { params: Promise<{ habitId: string }> }): Promise<Response> {
  const user = await verifyRequest(req);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { habitId } = await ctx.params;

  const days = Math.max(1, Math.min(365, parseInt(req.nextUrl.searchParams.get("days") ?? "90", 10)));
  const fs = getAdminFirestore();
  const habitRef = fs.doc(`users/${user.uid}/calendar/habits/${habitId}`);
  const habitSnap = await habitRef.get();
  if (!habitSnap.exists) return NextResponse.json({ error: "habit not found" }, { status: 404 });
  const habit = habitSnap.data() as Habit;

  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const completionsCol = habitRef.collection("completions");
  const snap = await completionsCol.where("date", ">=", since).orderBy("date", "desc").limit(days + 50).get();
  const completions = snap.docs.map((d) => d.data() as CompletionEntry);

  const streak = computeStreak(habit, completions);
  return NextResponse.json({ ok: true, completions, streak });
}
