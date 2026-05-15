/**
 * Research Planner — scan orchestrator + learning loop.
 *
 * `scanProject(projectId, ownerId)`:
 *   1. Fetch every input the detectors need in parallel
 *   2. Run all three detectors
 *   3. Load the project's learning weights
 *   4. Multiply each candidate's rawScore by the kind's weight
 *   5. Dedupe against existing pending + dismissed suggestions by
 *      fingerprint (the user dismissed it once; don't re-pester)
 *   6. Persist new ones with status="pending"
 *
 * `applyLearningDelta(...)`:
 *   Pure function — given current weights and an accept/dismiss
 *   event, return the updated weights. Used by the UI's optimistic
 *   updates and by `acceptSuggestion`/`dismissSuggestion` callers.
 */

import {
  collection,
  getDocs,
  query,
  where,
  type DocumentData,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import {
  getProjectDocuments,
  type FirestoreDocument,
} from "@/lib/firebase/firestore";
import {
  detectContradictions,
  detectUndersupportedClaims,
  detectUnderreadTopics,
  type ClaimRow,
  type ContradictionRow,
  type DocumentRow,
  type SnippetRow,
  type SuggestionCandidate,
} from "./detectors";
import {
  createSuggestion,
  listSuggestions,
  loadWeights,
  saveWeights,
} from "./firestore";
import {
  ACCEPT_BUMP,
  DEFAULT_KIND_WEIGHT,
  DISMISS_DROP,
  WEIGHT_CEILING,
  WEIGHT_FLOOR,
  type PlannerWeights,
  type ScanResult,
  type Suggestion,
  type SuggestionKind,
} from "./types";

/* ── Scan ────────────────────────────────────────────────────── */

export async function scanProject(
  projectId: string,
  ownerId: string,
): Promise<ScanResult> {
  // Inputs in parallel — none of them depend on each other.
  const [docsRaw, claimsRaw, snippetsRaw, contradictionsRaw, queriesRaw] =
    await Promise.all([
      getProjectDocuments(projectId, ownerId),
      fetchClaims(projectId, ownerId),
      fetchSnippets(projectId, ownerId),
      fetchContradictions(projectId, ownerId),
      fetchQueries(projectId, ownerId),
    ]);

  const documents: DocumentRow[] = docsRaw.map(docToRow);
  const claims: ClaimRow[] = claimsRaw;
  const snippets: SnippetRow[] = snippetsRaw;
  const contradictions: ContradictionRow[] = contradictionsRaw;
  const queries = queriesRaw;

  const claimsById = new Map(claims.map((c) => [c.id, c]));

  // ── Detectors ────────────────────────────────────────────
  const candidates: SuggestionCandidate[] = [
    ...detectUndersupportedClaims(claims),
    ...detectUnderreadTopics({ documents, claims, snippets, queries }),
    ...detectContradictions({ contradictions, claimsById }),
  ];

  // ── Weighted score ──────────────────────────────────────
  const weights = await loadWeights(projectId, ownerId);

  // ── Dedup against existing (pending + dismissed) ────────
  const existingPending = await listSuggestions(projectId, ownerId, "pending");
  const existingDismissed = await listSuggestions(projectId, ownerId, "dismissed");
  const pendingFingerprints = new Set(existingPending.map((s) => s.fingerprint));
  const dismissedFingerprints = new Set(existingDismissed.map((s) => s.fingerprint));

  let dedupedPending = 0;
  let dedupedDismissed = 0;
  let persisted = 0;

  for (const cand of candidates) {
    if (pendingFingerprints.has(cand.fingerprint)) {
      dedupedPending++;
      continue;
    }
    if (dismissedFingerprints.has(cand.fingerprint)) {
      dedupedDismissed++;
      continue;
    }
    const kindWeight = weights.weights[cand.kind] ?? DEFAULT_KIND_WEIGHT;
    // If the kind is heavily suppressed (weight ≤ floor), don't even
    // surface it — the user has demonstrated they don't want this kind.
    if (kindWeight <= WEIGHT_FLOOR + 1e-6) continue;
    const weightedScore = clamp01(cand.rawScore * kindWeight);

    await createSuggestion({
      projectId,
      ownerId,
      kind: cand.kind,
      title: cand.title,
      rationale: cand.rationale,
      proposedAction: cand.proposedAction,
      fingerprint: cand.fingerprint,
      refs: cand.refs,
      rawScore: cand.rawScore,
      weightedScore,
    });
    persisted++;
  }

  return {
    newlyPersisted: persisted,
    dedupedAgainstPending: dedupedPending,
    dedupedAgainstDismissed: dedupedDismissed,
    totalDetected: candidates.length,
  };
}

/* ── Learning ────────────────────────────────────────────────── */

/**
 * Pure delta — given current weights + an event, return the next
 * weights. Caller persists.
 */
export function applyLearningDelta(
  weights: PlannerWeights,
  event: { kind: SuggestionKind; action: "accept" | "dismiss" },
): PlannerWeights {
  const current = weights.weights[event.kind] ?? DEFAULT_KIND_WEIGHT;
  const next =
    event.action === "accept"
      ? Math.min(WEIGHT_CEILING, current * (1 + ACCEPT_BUMP))
      : Math.max(WEIGHT_FLOOR, current * (1 - DISMISS_DROP));

  return {
    ...weights,
    weights: { ...weights.weights, [event.kind]: next },
    acceptCounts: {
      ...weights.acceptCounts,
      [event.kind]:
        weights.acceptCounts[event.kind] + (event.action === "accept" ? 1 : 0),
    },
    dismissCounts: {
      ...weights.dismissCounts,
      [event.kind]:
        weights.dismissCounts[event.kind] + (event.action === "dismiss" ? 1 : 0),
    },
    updatedAt: Date.now(),
  };
}

/**
 * Convenience: pull current weights, apply delta, save, return next.
 * This is what the UI calls after accept/dismiss to keep the learned
 * state on disk.
 *
 * NOTE: `acceptSuggestion` / `dismissSuggestion` already increment
 * `acceptCounts` / `dismissCounts` via Firestore `increment()`. This
 * function is for the *weight multiplier* update, which can't be
 * expressed as an atomic Firestore op. We accept the read-modify-write
 * race here because the worst case is one off-by-one bump that the
 * next call corrects.
 */
export async function recordDecision(
  projectId: string,
  ownerId: string,
  kind: SuggestionKind,
  action: "accept" | "dismiss",
): Promise<PlannerWeights> {
  const current = await loadWeights(projectId, ownerId);
  const next = applyLearningDelta(current, { kind, action });
  await saveWeights(next);
  return next;
}

/* ── Source readers ──────────────────────────────────────────── */

async function fetchClaims(
  projectId: string,
  ownerId: string,
): Promise<ClaimRow[]> {
  try {
    const snap = await getDocs(
      query(
        collection(db, "veritasClaims"),
        where("ownerId", "==", ownerId),
        where("projectId", "==", projectId),
      ),
    );
    return snap.docs.map((d) => {
      const data = d.data() as DocumentData;
      return {
        id: d.id,
        projectId: data.projectId,
        atomicAssertion: data.atomicAssertion ?? "",
        text: data.text ?? "",
        sourceSupport: data.sourceSupport,
        retired: data.retired === true,
      };
    });
  } catch {
    return [];
  }
}

async function fetchSnippets(
  projectId: string,
  ownerId: string,
): Promise<SnippetRow[]> {
  try {
    const snap = await getDocs(
      query(
        collection(db, "recallSnippets"),
        where("ownerId", "==", ownerId),
        where("projectId", "==", projectId),
      ),
    );
    return snap.docs.map((d) => {
      const data = d.data() as DocumentData;
      return {
        id: d.id,
        projectId: data.projectId,
        text: data.text ?? "",
      };
    });
  } catch {
    return [];
  }
}

async function fetchContradictions(
  projectId: string,
  ownerId: string,
): Promise<ContradictionRow[]> {
  try {
    const snap = await getDocs(
      query(
        collection(db, "veritasContradictions"),
        where("ownerId", "==", ownerId),
        where("projectId", "==", projectId),
      ),
    );
    return snap.docs.map((d) => {
      const data = d.data() as DocumentData;
      return {
        id: d.id,
        projectId: data.projectId,
        a: data.a,
        b: data.b,
        status: data.status ?? "open",
        score: typeof data.score === "number" ? data.score : undefined,
      };
    });
  } catch {
    return [];
  }
}

async function fetchQueries(
  projectId: string,
  ownerId: string,
): Promise<Array<{ id: string; query?: string; answer?: string }>> {
  try {
    const snap = await getDocs(
      query(
        collection(db, "queries"),
        where("userId", "==", ownerId),
        where("projectId", "==", projectId),
      ),
    );
    return snap.docs.map((d) => {
      const data = d.data() as DocumentData;
      return {
        id: d.id,
        query: data.query ?? "",
        answer: data.answer ?? "",
      };
    });
  } catch {
    return [];
  }
}

function docToRow(d: FirestoreDocument): DocumentRow {
  return {
    id: d.id,
    projectId: d.projectId,
    title: d.title,
    content: d.content,
    updatedAt: typeof d.updatedAt === "object" && d.updatedAt && "toMillis" in d.updatedAt ? (d.updatedAt as { toMillis(): number }).toMillis() : 0,
  };
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/* ── Re-export Suggestion type for orchestrator callers ─────── */

export type { Suggestion };
