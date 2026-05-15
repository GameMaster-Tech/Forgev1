/**
 * Counterforge — scan orchestrator.
 *
 * `scanProject(projectId, ownerId)`:
 *   1. Fetch documents, claims, snippets in parallel.
 *   2. Extract load-bearing claims from each document.
 *   3. For each claim, run counter-evidence detection over corpus.
 *   4. Synthesise counter-argument for each claim that cleared the
 *      surface threshold.
 *   5. Dedup by fingerprint against existing cases.
 *   6. Persist new ones with status="open".
 *
 * `markStale(projectId)`:
 *   Mark every "open" case whose claim text no longer appears in any
 *   document as `stale`. Cheap O(N×M) scan but N is bounded.
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
  createCounterCase,
  findCounterCaseByFingerprint,
  listCounterCases,
  loadSettings,
  updateCounterCase,
} from "./firestore";
import {
  extractLoadBearingClaims,
  findCounterEvidence,
  fingerprintClaim,
  synthesiseCounterArgument,
  type ClaimRow,
  type DocSection,
  type SnippetRow,
} from "./detect";
import type { CounterforgeRunSummary, CounterEvidence } from "./types";

export async function scanProject(
  projectId: string,
  ownerId: string,
): Promise<CounterforgeRunSummary> {
  const t0 = Date.now();

  const [docsRaw, claims, snippets, settings] = await Promise.all([
    getProjectDocuments(projectId, ownerId),
    fetchClaims(projectId, ownerId),
    fetchSnippets(projectId, ownerId),
    loadSettings(projectId, ownerId),
  ]);

  // Flatten documents into doc sections (paragraph-grained) and a
  // running list of all claim candidates with provenance.
  const sections: DocSection[] = [];
  const claimCandidates: Array<{
    text: string;
    documentId?: string;
    paragraphIdx?: number;
  }> = [];

  for (const d of docsRaw) {
    const plainText = stripTipTap(d.content);
    if (!plainText) continue;
    const paragraphs = plainText.split(/\n{2,}/);
    paragraphs.forEach((p, idx) => {
      const t = p.trim();
      if (t.length < 40) return;
      sections.push({ documentId: d.id, paragraphIdx: idx, text: t });
      for (const claim of extractLoadBearingClaims(t)) {
        claimCandidates.push({ text: claim, documentId: d.id, paragraphIdx: idx });
      }
    });
  }

  // Dedup claims by fingerprint within this run to avoid double-work
  // when the same sentence appears in two documents (e.g. abstract
  // duplicated into intro).
  const seen = new Map<string, (typeof claimCandidates)[number]>();
  for (const c of claimCandidates) {
    const fp = fingerprintClaim(projectId, c.text);
    if (!seen.has(fp)) seen.set(fp, c);
  }

  let newCases = 0;
  let totalConsidered = 0;

  for (const [fingerprint, { text, documentId, paragraphIdx }] of seen) {
    const existing = await findCounterCaseByFingerprint(
      projectId,
      ownerId,
      fingerprint,
    );
    if (existing) continue;

    // Optionally skip well-supported claims (matched to a Forge
    // veritasClaim row with sourceSupport ∈ {strong, consensus}).
    if (settings.skipWellSupported) {
      const matched = matchKnownClaim(text, claims);
      if (
        matched &&
        (matched.sourceSupport === "strong" || matched.sourceSupport === "consensus")
      ) {
        continue;
      }
    }

    const evidence = findCounterEvidence({
      claimText: text,
      snippets,
      claims,
      documents: sections,
      maxPerCase: 5,
    });
    totalConsidered += evidence.length;
    if (evidence.length === 0) continue;

    const { argument, strength } = synthesiseCounterArgument(text, evidence);
    const topScore = evidence[0].score;
    if (topScore < settings.surfaceThreshold) continue;

    const evidenceRows: CounterEvidence[] = evidence.map((e) => ({
      text: e.text,
      sourceRef: e.sourceRef,
      kind: e.kind,
      strength:
        e.score >= 0.65 ? "strong" : e.score >= 0.40 ? "moderate" : "weak",
    }));

    const matched = matchKnownClaim(text, claims);
    await createCounterCase({
      projectId,
      ownerId,
      claimText: text.slice(0, 240),
      claimId: matched?.id,
      documentId,
      paragraphIdx,
      counterArgument: argument,
      evidence: evidenceRows,
      overallStrength: strength,
      fingerprint,
    });
    newCases++;
  }

  // Mark stale: any open case whose claim text no longer appears in any
  // document paragraph (post-edit). Cheap O(open×sections) string check.
  const allCases = await listCounterCases(projectId, ownerId);
  let rescoredStale = 0;
  const corpusBlob = sections.map((s) => s.text).join("\n");
  for (const c of allCases) {
    if (c.status !== "open" && c.status !== "deferred") continue;
    const needle = c.claimText.slice(0, 60); // first 60 chars is enough
    if (!corpusBlob.includes(needle)) {
      await updateCounterCase(c.id, { status: "stale" });
      rescoredStale++;
    }
  }

  return {
    newCases,
    rescoredStale,
    totalClaimsExamined: seen.size,
    totalCounterEvidenceConsidered: totalConsidered,
    durationMs: Date.now() - t0,
  };
}

/* ── Helpers ────────────────────────────────────────────────── */

function matchKnownClaim(
  text: string,
  claims: ReadonlyArray<ClaimRow>,
): ClaimRow | undefined {
  const lower = text.toLowerCase();
  for (const c of claims) {
    const target = (c.atomicAssertion || c.text || "").toLowerCase();
    if (!target) continue;
    // Cheap substring match — if the doc sentence contains the
    // canonical assertion (or vice versa), they're "the same claim."
    if (lower.includes(target) || target.includes(lower)) return c;
  }
  return undefined;
}

function stripTipTap(node: unknown): string {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object") return "";
  const n = node as { text?: unknown; content?: unknown; type?: string };
  let s = "";
  if (typeof n.text === "string") s += n.text;
  if (Array.isArray(n.content)) {
    for (const c of n.content) {
      s += " " + stripTipTap(c);
    }
  }
  // Paragraph nodes separate with a blank line so the section splitter
  // produces real paragraphs.
  if (n.type === "paragraph") s += "\n\n";
  return s;
}

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
        atomicAssertion: data.atomicAssertion ?? "",
        text: data.text ?? "",
        polarity: data.polarity,
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
        text: data.text ?? "",
        origin: data.origin,
        sourceRef: data.sourceRef ?? undefined,
      };
    });
  } catch {
    return [];
  }
}

// Suppress unused FirestoreDocument warning — `getProjectDocuments`'s
// return type uses it transitively. We just need the runtime values.
void ({} as FirestoreDocument);
