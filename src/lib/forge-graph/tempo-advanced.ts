/**
 * Tempo — advanced calendar automation (spec §4 Phase 3).
 *
 * Where `tempo.ts` provides the spec's literal V6.5 contract
 * (`executeCalendarSorting`), this module is the full operational
 * engine the spec demands: once a confirmed delta is accepted, walk
 * the entire downstream dependency closure, compact dead administrative
 * gaps, and resolve every multi-booking error before the persistence
 * layer writes back.
 *
 * Algorithm:
 *   1. Apply each mutation to a fresh fork.
 *   2. Topologically order calendar+task nodes by start date.
 *   3. PASS 1 — cascade propagation. For every node whose start was
 *      shifted, walk downstream and recursively shift dependents to
 *      preserve the *original* spacing-to-parent.
 *   4. PASS 2 — multi-booking detection. Build a per-attendee timeline
 *      and detect overlap; emit MultiBookingFix entries and resolve by
 *      sliding the lower-priority event.
 *   5. PASS 3 — gap compaction. For each contiguous day's events, slide
 *      non-pinned events earlier into any gap larger than a configured
 *      floor while respecting the user's day-start anchor.
 *
 * The engine is pure: it takes a graph map + delta and returns a new
 * map + a structured `TempoRunReport`. It does not write to Firestore;
 * that's `persistence.applyDeltaToSources` + `tempo-runs.recordRun`.
 */

import {
  ForgeNodeCategory,
  type ForgeGraphNode,
  type NodeId,
  type VisualDeltaMap,
} from "./types";
import { topoSort } from "./builder";

export interface MultiBookingFix {
  attendeeKey: string;
  movedNodeId: NodeId;
  /** ISO timestamp the moved node now starts at. */
  newStart: string;
  conflictWithNodeId: NodeId;
}

export interface CompactionMove {
  nodeId: NodeId;
  shiftedByMinutes: number;
  reason: "gap-fill" | "cascade" | "multi-booking";
}

export interface TempoRunReport {
  /** Mutations from the source delta applied verbatim. */
  appliedMutations: number;
  /** Nodes whose start/end shifted because an upstream node moved. */
  cascadeShifts: CompactionMove[];
  /** Attendee-overlap fixes. */
  multiBookings: MultiBookingFix[];
  /** Gap-compaction moves. */
  compactions: CompactionMove[];
  /** ISO timestamp the run completed at. */
  ranAt: string;
}

export interface TempoOptions {
  /**
   * Minimum gap, in minutes, that the compactor will try to close.
   * Smaller gaps are usually intentional buffers. Default 15.
   */
  gapFillFloorMinutes?: number;
  /**
   * Earliest local-time anchor (HH:MM) compactor uses as the start of
   * each day. Default "08:00".
   */
  dayStart?: string;
  /**
   * When true, multi-booking resolution slides the LOWER-energy event
   * forward; when false, it slides the LATER-start event. Default true.
   */
  preferEnergyOverArrival?: boolean;
}

export class AdvancedTempoEngine {
  private readonly options: Required<TempoOptions>;

  constructor(options: TempoOptions = {}) {
    this.options = {
      gapFillFloorMinutes: options.gapFillFloorMinutes ?? 15,
      dayStart: options.dayStart ?? "08:00",
      preferEnergyOverArrival: options.preferEnergyOverArrival ?? true,
    };
  }

  /** Run the full Tempo pipeline against an accepted delta. */
  execute(
    graph: Map<NodeId, ForgeGraphNode>,
    delta: VisualDeltaMap,
  ): { graph: Map<NodeId, ForgeGraphNode>; report: TempoRunReport } {
    if (!delta.isViable) {
      throw new Error(
        "AdvancedTempoEngine refuses to run a non-viable delta — invariants must pass first.",
      );
    }

    const fork = forkForTempo(graph);
    const baselineStarts = snapshotStarts(graph);

    // PASS 0 — apply the literal mutations.
    let appliedMutations = 0;
    for (let i = 0; i < delta.mutations.length; i++) {
      const m = delta.mutations[i];
      const node = fork.get(m.nodeId);
      if (!node) continue;
      writeMutation(node, m.targetField, m.proposedValue);
      node.version += 1;
      node.status = "STABLE";
      appliedMutations += 1;
    }

    // PASS 1 — cascade propagation in topo order.
    const cascadeShifts: CompactionMove[] = [];
    const topo = topoSort(fork);
    for (let i = 0; i < topo.length; i++) {
      const node = fork.get(topo[i]);
      if (!node) continue;
      const newStart = startMs(node);
      const oldStart = baselineStarts.get(node.id);
      if (newStart == null || oldStart == null) continue;
      const shiftMs = newStart - oldStart;
      if (shiftMs === 0) continue;

      for (let j = 0; j < node.downstreamDependencies.length; j++) {
        const child = fork.get(node.downstreamDependencies[j]);
        if (!child) continue;
        if (!isShiftable(child)) continue;
        if (child.payload.metadata.pinned === true) continue;
        const childOldStart = baselineStarts.get(child.id);
        if (childOldStart == null) continue;
        const childCurrentStart = startMs(child) ?? childOldStart;
        const desired = childOldStart + shiftMs;
        if (desired <= childCurrentStart) continue;
        const moved = desired - childCurrentStart;
        shiftNode(child, moved);
        cascadeShifts.push({
          nodeId: child.id,
          shiftedByMinutes: Math.round(moved / 60_000),
          reason: "cascade",
        });
      }
    }

    // PASS 2 — multi-booking detection by attendee.
    const multiBookings = this.resolveMultiBookings(fork);

    // PASS 3 — gap compaction.
    const compactions = this.compactGaps(fork);

    return {
      graph: fork,
      report: {
        appliedMutations,
        cascadeShifts,
        multiBookings,
        compactions,
        ranAt: new Date().toISOString(),
      },
    };
  }

  /* ──────── Multi-booking ──────── */

  private resolveMultiBookings(
    graph: Map<NodeId, ForgeGraphNode>,
  ): MultiBookingFix[] {
    interface Booking {
      nodeId: NodeId;
      start: number;
      end: number;
      energyWeight: number;
    }
    const byAttendee = new Map<string, Booking[]>();
    for (const node of graph.values()) {
      if (node.category !== ForgeNodeCategory.CALENDAR_EVENT) continue;
      const start = startMs(node);
      const end = endMs(node);
      if (start == null || end == null) continue;
      const attendees = node.payload.metadata.attendees as
        | Array<{ email?: string; name?: string }>
        | undefined;
      const keys: string[] = [];
      if (Array.isArray(attendees)) {
        for (let i = 0; i < attendees.length; i++) {
          const k = (attendees[i].email ?? attendees[i].name)?.trim().toLowerCase();
          if (k) keys.push(`attendee:${k}`);
        }
      }
      // The owner always counts — same-calendar overlap is also a
      // multi-booking error in the spec sense.
      keys.push(`owner:${node.origin.projectId ?? "personal"}`);

      const weight = energyWeight(node);
      for (let i = 0; i < keys.length; i++) {
        const arr = byAttendee.get(keys[i]);
        if (arr) arr.push({ nodeId: node.id, start, end, energyWeight: weight });
        else byAttendee.set(keys[i], [{ nodeId: node.id, start, end, energyWeight: weight }]);
      }
    }

    const fixes: MultiBookingFix[] = [];
    for (const [attendeeKey, bookings] of byAttendee.entries()) {
      bookings.sort((a, b) => a.start - b.start);
      for (let i = 1; i < bookings.length; i++) {
        const prev = bookings[i - 1];
        const curr = bookings[i];
        if (curr.start >= prev.end) continue;

        // Decide who slides. By default the *lower*-weight (less deep
        // energy) event moves; tie-break by arrival.
        let mover = curr;
        let stayer = prev;
        if (
          this.options.preferEnergyOverArrival &&
          prev.energyWeight < curr.energyWeight
        ) {
          mover = prev;
          stayer = curr;
        }
        const moverNode = graph.get(mover.nodeId);
        if (!moverNode || moverNode.payload.metadata.pinned === true) continue;
        const overlapMs = stayer.end - mover.start;
        shiftNode(moverNode, overlapMs);
        mover.start += overlapMs;
        mover.end += overlapMs;
        fixes.push({
          attendeeKey,
          movedNodeId: mover.nodeId,
          newStart: new Date(mover.start).toISOString(),
          conflictWithNodeId: stayer.nodeId,
        });
      }
    }
    return fixes;
  }

  /* ──────── Gap compaction ──────── */

  private compactGaps(graph: Map<NodeId, ForgeGraphNode>): CompactionMove[] {
    const floorMs = this.options.gapFillFloorMinutes * 60_000;
    const events: Array<{ id: NodeId; start: number; end: number }> = [];
    for (const node of graph.values()) {
      if (node.category !== ForgeNodeCategory.CALENDAR_EVENT) continue;
      if (node.payload.metadata.pinned === true) continue;
      const start = startMs(node);
      const end = endMs(node);
      if (start == null || end == null) continue;
      events.push({ id: node.id, start, end });
    }
    events.sort((a, b) => a.start - b.start);

    const moves: CompactionMove[] = [];
    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1];
      const curr = events[i];
      // Only compact same-day pairs to avoid pulling a Wednesday event
      // into Tuesday's tail.
      if (!sameLocalDay(prev.start, curr.start)) continue;
      const gap = curr.start - prev.end;
      if (gap <= floorMs) continue;
      const node = graph.get(curr.id);
      if (!node) continue;

      // Respect upstream-buffer: don't pull a node ahead of an upstream
      // dependency's end.
      const upstreamLimit = upstreamLatestEnd(node, graph);
      const newStart = Math.max(prev.end, upstreamLimit ?? prev.end);
      if (newStart >= curr.start) continue;
      const moved = curr.start - newStart;
      shiftNode(node, -moved);
      curr.start -= moved;
      curr.end -= moved;
      moves.push({
        nodeId: node.id,
        shiftedByMinutes: -Math.round(moved / 60_000),
        reason: "gap-fill",
      });
    }
    return moves;
  }
}

/* ────────────────────── helpers ────────────────────── */

function forkForTempo(
  graph: Map<NodeId, ForgeGraphNode>,
): Map<NodeId, ForgeGraphNode> {
  const fork = new Map<NodeId, ForgeGraphNode>();
  for (const [id, node] of graph.entries()) {
    fork.set(id, {
      ...node,
      payload: {
        title: node.payload.title,
        content: node.payload.content,
        metadata: { ...node.payload.metadata },
      },
      upstreamDependencies: node.upstreamDependencies.slice(),
      downstreamDependencies: node.downstreamDependencies.slice(),
    });
  }
  return fork;
}

function snapshotStarts(
  graph: Map<NodeId, ForgeGraphNode>,
): Map<NodeId, number> {
  const out = new Map<NodeId, number>();
  for (const node of graph.values()) {
    const s = startMs(node);
    if (s != null) out.set(node.id, s);
  }
  return out;
}

function isShiftable(node: ForgeGraphNode): boolean {
  return (
    node.category === ForgeNodeCategory.CALENDAR_EVENT ||
    node.category === ForgeNodeCategory.TASK
  );
}

function startMs(node: ForgeGraphNode): number | null {
  const v = node.payload.metadata.startDate;
  return v instanceof Date ? v.getTime() : null;
}

function endMs(node: ForgeGraphNode): number | null {
  const v = node.payload.metadata.endDate;
  if (v instanceof Date) return v.getTime();
  const start = startMs(node);
  const duration = node.payload.metadata.durationHours;
  if (start == null || typeof duration !== "number") return null;
  return start + duration * 3_600_000;
}

function shiftNode(node: ForgeGraphNode, deltaMs: number): void {
  const start = node.payload.metadata.startDate;
  if (start instanceof Date) {
    node.payload.metadata.startDate = new Date(start.getTime() + deltaMs);
  }
  const end = node.payload.metadata.endDate;
  if (end instanceof Date) {
    node.payload.metadata.endDate = new Date(end.getTime() + deltaMs);
  }
  node.version += 1;
}

function writeMutation(
  node: ForgeGraphNode,
  targetField: string,
  proposedValue: unknown,
): void {
  if (targetField === "title") {
    node.payload.title = String(proposedValue);
    return;
  }
  if (targetField === "content") {
    node.payload.content = String(proposedValue);
    return;
  }
  if (!targetField.startsWith("metadata.")) return;
  const key = targetField.slice("metadata.".length);
  if (key === "startDate" || key === "endDate") {
    node.payload.metadata[key] =
      proposedValue instanceof Date
        ? proposedValue
        : new Date(proposedValue as string | number);
    return;
  }
  node.payload.metadata[key] = proposedValue;
}

function energyWeight(node: ForgeGraphNode): number {
  const e = node.payload.metadata.energy as string | undefined;
  switch (e) {
    case "deep":
      return 100;
    case "creative":
      return 70;
    case "social":
      return 40;
    case "shallow":
      return 30;
    case "rest":
      return 5;
    default:
      return 50;
  }
}

function sameLocalDay(aMs: number, bMs: number): boolean {
  const a = new Date(aMs);
  const b = new Date(bMs);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function upstreamLatestEnd(
  node: ForgeGraphNode,
  graph: Map<NodeId, ForgeGraphNode>,
): number | null {
  let latest: number | null = null;
  for (let i = 0; i < node.upstreamDependencies.length; i++) {
    const parent = graph.get(node.upstreamDependencies[i]);
    if (!parent) continue;
    const e = endMs(parent);
    if (e == null) continue;
    if (latest == null || e > latest) latest = e;
  }
  return latest;
}
