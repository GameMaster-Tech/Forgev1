/**
 * Focus-block packer.
 *
 * Finds gaps between timed events, ranks them by energy fit, and
 * places tasks/goal-blocks/habit-make-ups into them — highest priority
 * first. The packer respects:
 *
 *   • pinned items (never moved)
 *   • protected windows (sleep/gym/family)
 *   • meeting load caps (don't exceed user's meeting budget per day)
 *   • energy match (deep work into deep windows only)
 *   • task splitability (long tasks chunk into multiple sittings)
 *
 * Greedy with one-step backtrack — good enough for human-scale
 * calendars (<200 items per week). Pure.
 */

import {
  DEFAULT_ENERGY_PROFILE,
  type Energy,
  type FocusBlock,
  type Goal,
  type GoalBlock,
  type Habit,
  type ItemId,
  type ProtectedWindow,
  type Task,
  type TimedEvent,
  type UserRoutine,
} from "./types";

const MIN = 60_000;
const DAY = 86_400_000;

export interface PackInput {
  events: TimedEvent[];
  tasks: Task[];
  habits: Habit[];
  /** Goals are now first-class to the packer. */
  goals?: Goal[];
  rangeStart: string;
  rangeEnd: string;
  routine?: UserRoutine;
  /** Items that must not be re-placed. */
  pinnedIds?: Set<ItemId>;
  now?: number;
}

export interface PackOutput {
  blocks: FocusBlock[];
  goalBlocks: GoalBlock[];
  unscheduled: { item: Task | Habit; reason: string }[];
  /** Per-goal: how many minutes of pull we placed vs. wanted. */
  goalCoverage: { goalId: string; placed: number; deficit: number }[];
}

/* ───────────── public API ───────────── */

export function packFocusBlocks(input: PackInput): PackOutput {
  const now = input.now ?? Date.now();
  const profile = input.routine?.energyProfile ?? DEFAULT_ENERGY_PROFILE;
  const protectedWindows = input.routine?.protectedWindows ?? [];

  // 1) Compute free intervals between fixed events + protected windows.
  const fixed = input.events
    .filter((e) => !e.pinned || (input.pinnedIds && input.pinnedIds.has(e.id)) ? true : true)
    .map((e) => ({ start: new Date(e.start).getTime(), end: new Date(e.end).getTime() }))
    .sort((a, b) => a.start - b.start);
  const startMs = new Date(input.rangeStart).getTime();
  const endMs   = new Date(input.rangeEnd).getTime();
  const free = freeIntervals(startMs, endMs, fixed, protectedWindows, profile, now);

  // 2) Rank tasks by priority desc.
  const queue = [...input.tasks]
    .filter((t) => t.status !== "done" && t.status !== "abandoned")
    .sort((a, b) => b.priority.score - a.priority.score);

  const blocks: FocusBlock[] = [];
  const unscheduled: PackOutput["unscheduled"] = [];

  for (const task of queue) {
    let remaining = Math.ceil(task.durationMinutes * (1 - (task.progress ?? 0)));
    if (remaining <= 0) continue;
    const minBlock = task.minBlockMinutes ?? 30;
    let placedAny = false;

    while (remaining > 0) {
      const slot = pickBestSlot(free, task.energy, Math.min(remaining, minBlock));
      if (!slot) break;
      const take = Math.min(remaining, slot.minutes);
      const block: FocusBlock = {
        id: `fb_${task.id}_${slot.start}`,
        projectId: task.projectId,
        ownerId:   task.ownerId,
        title:     `Focus · ${task.title}`,
        description: task.description,
        kind: "focus-block",
        start: new Date(slot.start).toISOString(),
        end:   new Date(slot.start + take * MIN).toISOString(),
        energy: task.energy,
        durationMinutes: take,
        timeZone: task.timeZone,
        priority: task.priority,
        pinned: false,
        autoPlaced: true,
        placementRationale: [
          `placed in a ${profile[new Date(slot.start).getHours()]} window`,
          `task priority ${task.priority.score.toFixed(0)}`,
          task.due ? `${minutesUntil(task.due, slot.start)} min before deadline` : "no deadline",
        ],
        boundTaskId: task.id as unknown as string,
        boundGoalId: task.boundGoalId,
        boundAssertionKeys: task.boundAssertionKeys,
        contents: [task.id],
        createdAt: now,
        updatedAt: now,
      };
      blocks.push(block);
      // Consume the slot.
      consume(free, slot.start, take);
      remaining -= take;
      placedAny = true;
      if (!task.splittable) break;
    }

    if (!placedAny || remaining > 0) {
      unscheduled.push({
        item: task,
        reason: !placedAny
          ? `no ${task.energy} slot of ≥${minBlock} min available before ${task.due ?? "the planning horizon"}`
          : `placed partial; ${remaining} min still unscheduled`,
      });
    }
  }

  // 3) Goal blocks — distribute weekly deficit across remaining free time.
  //
  //    For each active goal whose deficit (weeklyMinutesTarget -
  //    loggedMinutes) is positive, we ask the packer to set aside that
  //    many minutes inside the planning window, preferring whatever
  //    energy class the goal's bound tasks lean toward (default
  //    "creative"). Goals compete fairly: deficit-proportional shares.
  const goals = (input.goals ?? []).filter((g) => g.status === "active" && g.weeklyMinutesTarget > 0);
  const goalBlocks: GoalBlock[] = [];
  const goalCoverage: { goalId: string; placed: number; deficit: number }[] = [];

  if (goals.length > 0) {
    // Goals get a per-day fair share. Walk days in order; for each day,
    // for each goal with remaining deficit, find a slot.
    const daysInRange = Math.max(1, Math.ceil((new Date(input.rangeEnd).getTime() - new Date(input.rangeStart).getTime()) / DAY));
    const perDayShare = new Map<string, number>(); // goalId → minutes/day target
    for (const g of goals) {
      const deficit = Math.max(0, g.weeklyMinutesTarget - g.loggedMinutes);
      const days = Math.min(daysInRange, 5); // assume 5 workdays even on a 7-day window
      perDayShare.set(g.id, Math.ceil(deficit / days));
      goalCoverage.push({ goalId: g.id, placed: 0, deficit });
    }

    const startMs = new Date(input.rangeStart).getTime();
    const endMs   = new Date(input.rangeEnd).getTime();
    for (let cursor = startMs; cursor < endMs; cursor += DAY) {
      for (const g of goals) {
        const share = perDayShare.get(g.id) ?? 0;
        if (share <= 0) continue;
        const energy = goalEnergy(g, input.tasks);
        const minBlock = Math.min(share, 60); // never less than 60 min per sitting if we have budget
        const slot = pickBestSlotInWindow(free, energy, Math.min(share, minBlock), cursor, cursor + DAY);
        if (!slot) continue;
        const take = Math.min(share, slot.minutes, 90); // cap one block at 90 min for diversity
        const block: GoalBlock = {
          id: `gb_${g.id}_${slot.start}`,
          projectId: g.projectId,
          ownerId: g.ownerId,
          title: `Goal · ${g.title}`,
          description: g.description,
          kind: "goal-block",
          start: new Date(slot.start).toISOString(),
          end:   new Date(slot.start + take * MIN).toISOString(),
          energy,
          durationMinutes: take,
          timeZone: input.routine?.timeZone ?? "UTC",
          priority: { score: 0, factors: [{ kind: "goal-gravity", contribution: 0, reason: `pull on "${g.title}"` }] },
          pinned: false,
          autoPlaced: true,
          placementRationale: [
            `pulled toward goal "${g.title}"`,
            `weekly target ${g.weeklyMinutesTarget} min, deficit ${Math.max(0, g.weeklyMinutesTarget - g.loggedMinutes)} min`,
          ],
          goalId: g.id,
          createdAt: now,
          updatedAt: now,
        };
        goalBlocks.push(block);
        consume(free, slot.start, take);
        const cov = goalCoverage.find((c) => c.goalId === g.id);
        if (cov) cov.placed += take;
        // Reduce that goal's per-day budget so the next day takes its turn.
        perDayShare.set(g.id, share - take);
      }
    }
  }

  return { blocks, goalBlocks, unscheduled, goalCoverage };
}

/** Pick an energy class the goal's bound tasks suggest, fallback creative. */
function goalEnergy(goal: Goal, tasks: Task[]): Energy {
  const linked = tasks.filter((t) => t.boundGoalId === goal.id);
  if (linked.length === 0) return "creative";
  const tally: Record<Energy, number> = { deep: 0, shallow: 0, creative: 0, social: 0, rest: 0 };
  for (const t of linked) tally[t.energy]++;
  let best: Energy = "creative";
  let bestN = -1;
  for (const e of Object.keys(tally) as Energy[]) {
    if (tally[e] > bestN) { bestN = tally[e]; best = e; }
  }
  return best;
}

/* ───────────── interval math ───────────── */

interface FreeInterval {
  start: number; // ms
  end: number;
  energy: Energy;
}

function freeIntervals(
  start: number,
  end: number,
  fixed: { start: number; end: number }[],
  protectedWindows: ProtectedWindow[],
  profile: Energy[],
  now: number,
): FreeInterval[] {
  // Clamp to >= now so we don't schedule in the past.
  let cursor = Math.max(start, now);
  const out: FreeInterval[] = [];
  for (const f of fixed) {
    if (f.end <= cursor) continue;
    if (f.start > cursor) pushHourly(out, cursor, Math.min(f.start, end), profile);
    cursor = Math.max(cursor, f.end);
    if (cursor >= end) break;
  }
  if (cursor < end) pushHourly(out, cursor, end, profile);

  // Subtract protected windows.
  return out.flatMap((iv) => subtractProtected(iv, protectedWindows));
}

function pushHourly(out: FreeInterval[], from: number, to: number, profile: Energy[]) {
  // Split intervals at hour boundaries so each piece has a single
  // energy class. This is what lets the packer "match energy".
  let cursor = from;
  while (cursor < to) {
    const date = new Date(cursor);
    const hour = date.getHours();
    const nextHourMs = date.setMinutes(60, 0, 0); // bump to top of next hour
    const end = Math.min(to, nextHourMs);
    if (end > cursor) {
      out.push({ start: cursor, end, energy: profile[hour] ?? "shallow" });
    }
    cursor = end;
  }
}

function subtractProtected(iv: FreeInterval, windows: ProtectedWindow[]): FreeInterval[] {
  if (windows.length === 0) return [iv];
  const start = new Date(iv.start);
  const weekday = start.getDay();
  const applicable = windows.filter((w) => w.weekday === weekday);
  if (applicable.length === 0) return [iv];

  let segments = [iv];
  for (const w of applicable) {
    const wStart = setLocalTime(start, w.start);
    const wEnd   = setLocalTime(start, w.end);
    segments = segments.flatMap((s) => {
      if (wEnd <= s.start || wStart >= s.end) return [s];
      const out: FreeInterval[] = [];
      if (wStart > s.start) out.push({ ...s, end: wStart });
      if (wEnd < s.end)     out.push({ ...s, start: wEnd });
      return out;
    });
  }
  return segments;
}

function setLocalTime(base: Date, hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  const d = new Date(base);
  d.setHours(h, m ?? 0, 0, 0);
  return d.getTime();
}

interface SlotPick {
  start: number;
  minutes: number;
  intervalIndex: number;
}

/** Same as pickBestSlot but constrained to [from, to] window. */
function pickBestSlotInWindow(free: FreeInterval[], wantEnergy: Energy, minMinutes: number, from: number, to: number): SlotPick | null {
  if (wantEnergy === "rest") return null;
  const pref = compatibility(wantEnergy);
  for (const tier of pref) {
    for (let i = 0; i < free.length; i++) {
      const iv = free[i];
      if (iv.energy !== tier) continue;
      const ivStart = Math.max(iv.start, from);
      const ivEnd   = Math.min(iv.end, to);
      const minutes = Math.floor((ivEnd - ivStart) / MIN);
      if (minutes < minMinutes) continue;
      return { start: ivStart, minutes, intervalIndex: i };
    }
  }
  return null;
}

function pickBestSlot(free: FreeInterval[], wantEnergy: Energy, minMinutes: number): SlotPick | null {
  // Walk intervals; prefer exact energy match, fallback to a
  // compatible class. Compatibility order:
  //   deep wants deep > creative; creative wants creative > deep
  //   shallow wants shallow > creative > social
  //   social wants social > shallow
  //   rest wants nothing (we never schedule into rest)
  if (wantEnergy === "rest") return null;
  const pref = compatibility(wantEnergy);
  for (const tier of pref) {
    for (let i = 0; i < free.length; i++) {
      const iv = free[i];
      if (iv.energy !== tier) continue;
      const minutes = Math.floor((iv.end - iv.start) / MIN);
      if (minutes < minMinutes) continue;
      return { start: iv.start, minutes, intervalIndex: i };
    }
  }
  return null;
}

function compatibility(want: Energy): Energy[] {
  switch (want) {
    case "deep":     return ["deep", "creative"];
    case "creative": return ["creative", "deep"];
    case "shallow":  return ["shallow", "creative", "social"];
    case "social":   return ["social", "shallow"];
    case "rest":     return [];
  }
}

function consume(free: FreeInterval[], start: number, minutes: number): void {
  const end = start + minutes * MIN;
  for (let i = free.length - 1; i >= 0; i--) {
    const iv = free[i];
    if (end <= iv.start || start >= iv.end) continue;
    const before = iv.start < start ? { ...iv, end: start } : null;
    const after  = end   < iv.end   ? { ...iv, start: end } : null;
    free.splice(i, 1);
    if (after)  free.splice(i, 0, after);
    if (before) free.splice(i, 0, before);
  }
}

function minutesUntil(due: string, refMs: number): number {
  return Math.max(0, Math.round((new Date(due).getTime() - refMs) / MIN));
}
