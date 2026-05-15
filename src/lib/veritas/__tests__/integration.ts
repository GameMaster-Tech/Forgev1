/**
 * Veritas Phase 1 — integration test script.
 *
 * Scope
 * ─────
 * Phase 1 delivered three things that need end-to-end validation:
 *
 *   1. `AsyncClaimGraph` + `AsyncEpisodeLog` interfaces (with the in-memory
 *      async wrappers used by tests and ForgeBench).
 *   2. Firestore converter round-trip — `claimToDoc` / `docToClaim` and
 *      friends must preserve every field modulo the injected `ownerId`.
 *   3. `MockBenchRunner` + `runBench` pipeline — oracle mode scores 1.0,
 *      zero mode scores low, and the pipeline never malforms.
 *
 * Running
 * ───────
 * No jest/vitest is wired. This file runs under Node 22+ native TS or via
 * `npx tsx` and exits non-zero on failure:
 *
 *   npx tsx src/lib/veritas/__tests__/integration.ts
 *
 * The module-level `main()` is called if this file is executed directly. It
 * is also exported so callers can compose it into a larger smoke suite.
 */

import assert from "node:assert/strict";

import {
  createInMemoryAsyncClaimGraph,
  createInMemoryAsyncEpisodeLog,
  createInMemoryClaimGraph,
  HashEmbedder,
  type AsyncClaimGraph,
  type AsyncEpisodeLog,
} from "../memory";
import type {
  Claim,
  ClaimLink,
  Contradiction,
} from "../memory/schema";
import {
  claimToDoc,
  docToClaim,
  linkToDoc,
  docToLink,
  contradictionToDoc,
  docToContradiction,
  episodeToDoc,
  docToEpisode,
  stripUndefined,
} from "../memory/firestore/converters";
import {
  canonicalHash,
  deterministicClaimId,
  deterministicContradictionId,
} from "../memory/ids";

import {
  MockBenchRunner,
  VeritasR1BenchRunner,
  runBench,
  type BenchTask,
} from "../bench";

import {
  traceToChatML,
  chatMLToTrace,
  TOOL_NAMES,
  episodeToSFTExample,
  inferMode,
  estimateTokens,
  validateSFTExample,
  SFT_SCHEMA_VERSION,
  type AssistantMessage,
  type ChatMessage,
  type SFTExample,
} from "../training-format";
import type { Episode, ThoughtStep, ThoughtTrace, Claim as ClaimT } from "../memory/schema";
import { isWellFormedStep } from "../memory/schema";

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/* ─────────────────────────────────────────────────────────────
 *  Test harness — minimal, zero deps
 * ──────────────────────────────────────────────────────────── */

interface TestCase {
  name: string;
  run: () => Promise<void> | void;
}

async function runAll(cases: TestCase[]): Promise<number> {
  let failures = 0;
  for (const tc of cases) {
    try {
      await tc.run();
      console.log(`  ok  ${tc.name}`);
    } catch (err) {
      failures++;
      const msg = err instanceof Error ? err.stack ?? err.message : String(err);
      console.error(`  FAIL  ${tc.name}\n${indent(msg, "        ")}`);
    }
  }
  return failures;
}

function indent(s: string, pad: string): string {
  return s.split("\n").map((line) => pad + line).join("\n");
}

/* ─────────────────────────────────────────────────────────────
 *  Fixture builders — small and schema-complete
 * ──────────────────────────────────────────────────────────── */

const PROJECT_ID = "proj-phase1";
const OWNER_ID = "user-phase1";

function makeClaimInput(
  atomic: string,
  overrides: Partial<Claim> = {},
): Parameters<AsyncClaimGraph["addClaim"]>[0] {
  return {
    projectId: PROJECT_ID,
    userId: OWNER_ID,
    text: atomic,
    atomicAssertion: atomic,
    polarity: "asserts",
    assertiveness: "direct",
    extractorCertainty: "high",
    sourceSupport: "moderate",
    scope: {},
    attributions: [],
    entities: [],
    ...overrides,
  };
}

/* ─────────────────────────────────────────────────────────────
 *  Tests
 * ──────────────────────────────────────────────────────────── */

async function testAsyncClaimGraphRoundTrip(): Promise<void> {
  const graph: AsyncClaimGraph = createInMemoryAsyncClaimGraph(PROJECT_ID);
  assert.equal(graph.projectId, PROJECT_ID);

  // add + dedup
  const a = await graph.addClaim(
    makeClaimInput("GLP-1 agonists reduce all-cause mortality in T2DM."),
  );
  const dup = await graph.addClaim(
    makeClaimInput("GLP-1 agonists reduce all-cause mortality in T2DM."),
  );
  assert.equal(dup.id, a.id, "canonical-hash dedup should return the first id");

  // list / get
  const byId = await graph.getClaim(a.id);
  assert.ok(byId, "getClaim should find added claim");
  assert.equal(byId?.atomicAssertion, a.atomicAssertion);

  const byHash = await graph.getByHash(a.canonicalHash);
  assert.equal(byHash?.id, a.id, "getByHash should resolve the dedup key");

  const listed = await graph.listClaims();
  assert.equal(listed.length, 1, "dedup keeps the list at size 1");

  // supersede
  const b = await graph.addClaim(
    makeClaimInput(
      "GLP-1 agonists reduce all-cause mortality and MACE in T2DM patients.",
    ),
  );
  await graph.supersede(a.id, b.id);
  const refreshedA = await graph.getClaim(a.id);
  const refreshedB = await graph.getClaim(b.id);
  assert.equal(refreshedA?.supersededBy, b.id);
  assert.ok(refreshedB?.supersedes.includes(a.id));

  // contradiction lifecycle
  const negation = await graph.addClaim(
    makeClaimInput("GLP-1 agonists do not reduce all-cause mortality.", {
      polarity: "negates",
    }),
  );
  const cd = await graph.addContradiction({
    projectId: PROJECT_ID,
    a: b.id,
    b: negation.id,
    detector: "heuristic",
    signals: ["opposite-polarity"],
    score: 0.85,
    status: "open",
  });
  assert.equal(cd.status, "open");
  const listCd = await graph.listContradictions({ onlyOpen: true });
  assert.equal(listCd.length, 1, "open contradiction should be listed");

  const touching = await graph.contradictionsOf(b.id);
  assert.equal(touching.length, 1);

  // update contradiction — append-only history
  const resolved = await graph.updateContradiction(cd.id, {
    status: "resolved-a-wins",
  });
  assert.ok(resolved);
  assert.equal(resolved?.status, "resolved-a-wins");
  const openLeft = await graph.listContradictions({ onlyOpen: true });
  assert.equal(openLeft.length, 0, "resolved should not appear in open list");

  // link edges
  const link: ClaimLink = await graph.addLink({
    projectId: PROJECT_ID,
    from: b.id,
    to: a.id,
    type: "refines",
    strength: 0.9,
  });
  const from = await graph.linksFrom(b.id);
  const to = await graph.linksTo(a.id);
  assert.ok(from.some((l) => l.id === link.id));
  assert.ok(to.some((l) => l.id === link.id));
}

async function testAsyncEpisodeLogRoundTrip(): Promise<void> {
  const log: AsyncEpisodeLog = createInMemoryAsyncEpisodeLog(PROJECT_ID);

  const ep1 = await log.append({
    projectId: PROJECT_ID,
    userId: OWNER_ID,
    type: "query",
    input: "What does the literature say about GLP-1 mortality?",
    output: "See claims clm-a, clm-b.",
    claimsReferenced: ["clm-a", "clm-b"],
    claimsCreated: [],
    claimsRetired: [],
    contradictionIds: [],
  });

  const ep2 = await log.append({
    projectId: PROJECT_ID,
    userId: OWNER_ID,
    type: "contradiction",
    input: "A contradicts B",
    claimsReferenced: [],
    claimsCreated: [],
    claimsRetired: [],
    contradictionIds: ["con-x"],
  });

  const chrono = await log.list();
  assert.equal(chrono.length, 2);
  assert.equal(chrono[0].id, ep1.id, "list is chronological oldest-first");

  const recent = await log.recent(1);
  assert.equal(recent.length, 1);
  assert.equal(recent[0].id, ep2.id, "recent is newest-first");

  const queries = await log.ofType("query");
  assert.equal(queries.length, 1);
  assert.equal(queries[0].id, ep1.id);

  const touching = await log.forClaim("clm-a");
  assert.equal(touching.length, 1);
  assert.equal(touching[0].id, ep1.id);

  const hits = await log.search("glp-1");
  assert.equal(hits.length, 1);

  await log.clear();
  assert.equal((await log.list()).length, 0);
}

async function testFirestoreConverterRoundTrip(): Promise<void> {
  const nowIso = "2026-04-24T00:00:00.000Z";
  const claim: Claim = {
    id: "clm-conv-1",
    projectId: PROJECT_ID,
    userId: OWNER_ID,
    canonicalHash: canonicalHash("convert me"),
    text: "convert me",
    atomicAssertion: "convert me",
    polarity: "asserts",
    assertiveness: "direct",
    extractorCertainty: "high",
    sourceSupport: "moderate",
    scope: {},
    attributions: [],
    entities: [],
    contradicts: [],
    supersedes: [],
    retired: false,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const claimDoc = claimToDoc(claim, OWNER_ID);
  assert.equal(claimDoc.ownerId, OWNER_ID);
  const claimBack = docToClaim(claimDoc);
  assert.deepEqual(claimBack, claim, "claim round-trip drops ownerId");

  const link: ClaimLink = {
    id: "cl-1",
    projectId: PROJECT_ID,
    from: claim.id,
    to: claim.id,
    type: "refines",
    strength: 0.5,
    createdAt: nowIso,
  };
  assert.deepEqual(docToLink(linkToDoc(link, OWNER_ID)), link);

  const contradiction: Contradiction = {
    id: "con-1",
    projectId: PROJECT_ID,
    a: "clm-a",
    b: "clm-b",
    detector: "heuristic",
    signals: ["opposite-polarity"],
    score: 0.9,
    status: "open",
    detectedAt: nowIso,
    updatedAt: nowIso,
  };
  assert.deepEqual(
    docToContradiction(contradictionToDoc(contradiction, OWNER_ID)),
    contradiction,
  );

  const episode: Episode = {
    id: "ep-1",
    projectId: PROJECT_ID,
    userId: OWNER_ID,
    timestamp: nowIso,
    type: "query",
    input: "test",
    claimsReferenced: [],
    claimsCreated: [],
    claimsRetired: [],
    contradictionIds: [],
  };
  assert.deepEqual(docToEpisode(episodeToDoc(episode, OWNER_ID)), episode);

  // stripUndefined: undefineds gone, null/[]/{} preserved
  const stripped = stripUndefined({
    a: undefined,
    b: null,
    c: [],
    d: {},
    e: 1,
    nested: { x: undefined, y: 2 },
  }) as Record<string, unknown>;
  assert.ok(!("a" in stripped), "undefined top-level key removed");
  assert.equal(stripped.b, null);
  assert.deepEqual(stripped.c, []);
  assert.deepEqual(stripped.d, {});
  assert.equal(stripped.e, 1);
  assert.deepEqual(stripped.nested, { y: 2 });
}

async function testMockBenchRunnerOracle(): Promise<void> {
  const citationTask: BenchTask = {
    id: "cit-smoke",
    suite: "citation",
    difficulty: "easy",
    title: "Smoke-test citation",
    prompt: "Cite the DOI for the primary source.",
    context: { claims: [], episodes: [], contradictions: [] },
    expected: { doi: "10.1234/smoke" },
  };
  const abstentionTask: BenchTask = {
    id: "abs-smoke",
    suite: "abstention",
    difficulty: "easy",
    title: "Smoke-test abstention",
    prompt: "Answer only if evidence is in the project memory.",
    context: { claims: [], episodes: [], contradictions: [] },
    expected: {
      mustAbstain: true,
      abstentionCues: ["I don't have enough evidence"],
    },
  };

  const oracle = new MockBenchRunner({ mode: "oracle" });
  const run = await runBench([citationTask, abstentionTask], oracle);
  assert.equal(run.overall.taskCount, 2);
  assert.equal(run.overall.passCount, 2, "oracle should pass every task");
  assert.ok(run.overall.avgScore >= 0.99, "oracle should score ~1.0");
  assert.equal(run.grades.every((g) => !g.malformed), true);

  const zero = new MockBenchRunner({ mode: "zero" });
  const zeroRun = await runBench([citationTask, abstentionTask], zero);
  assert.equal(zeroRun.overall.passCount, 0, "zero responses should not pass");
  assert.equal(
    zeroRun.grades.every((g) => !g.malformed),
    true,
    "zero responses are still well-formed (suite matches)",
  );
}

/* ─────────────────────────────────────────────────────────────
 *  Phase 2 — embedding-backed findSimilar, retire cascade,
 *  deterministic ids, VeritasR1BenchRunner transport.
 * ──────────────────────────────────────────────────────────── */

async function testEmbeddingBackedFindSimilar(): Promise<void> {
  // Wire the in-memory graph with the deterministic HashEmbedder. We use the
  // hash embedder (rather than Voyage) so the test is reproducible offline
  // and never makes a network call.
  const embedder = new HashEmbedder({ dim: 256 });
  const graph = createInMemoryAsyncClaimGraph(PROJECT_ID, { embedder });

  await graph.addClaim(
    makeClaimInput("GLP-1 agonists reduce all-cause mortality in T2DM."),
  );
  await graph.addClaim(
    makeClaimInput("SGLT2 inhibitors reduce hospitalisation for heart failure."),
  );
  await graph.addClaim(
    makeClaimInput("Coffee consumption correlates with longer telomeres."),
  );

  // Probe semantically close to claim #1 — share key tokens (mortality,
  // glp-1, t2dm). The HashEmbedder collapses to a bag-of-words bucketing,
  // so overlap on tokens drives non-trivial cosine.
  const ranked = await graph.findSimilar(
    "Do GLP-1 agonists lower mortality in type-2 diabetes?",
    3,
  );
  assert.ok(ranked.length > 0, "embedded findSimilar should return results");
  assert.ok(
    ranked[0].atomicAssertion.toLowerCase().includes("glp-1"),
    `top hit should mention GLP-1, got: ${ranked[0].atomicAssertion}`,
  );

  // Sanity: every claim added through the embedder-wired async graph
  // should have an inline `embedding` field with the right dim + modelId.
  const all = await graph.listClaims();
  for (const c of all) {
    assert.ok(c.embedding, `claim ${c.id} missing embedding`);
    assert.equal(c.embedding!.dim, 256);
    assert.equal(c.embedding!.modelId, "hash-bow-256");
    assert.equal(c.embedding!.vector.length, 256);
    // Vectors must be L2-normalised — cosine == dot product downstream.
    let sumSq = 0;
    for (const x of c.embedding!.vector) sumSq += x * x;
    const norm = Math.sqrt(sumSq);
    assert.ok(
      Math.abs(norm - 1) < 1e-6 || norm === 0,
      `embedding not L2-normalised (norm=${norm}) for ${c.id}`,
    );
  }
}

async function testFindSimilarLexicalFallback(): Promise<void> {
  // No embedder wired — must keep working via lexical Jaccard.
  const graph = createInMemoryAsyncClaimGraph(PROJECT_ID);
  await graph.addClaim(
    makeClaimInput("Vitamin D deficiency increases fracture risk in elderly adults."),
  );
  await graph.addClaim(
    makeClaimInput("Aspirin reduces colorectal cancer mortality."),
  );
  const hits = await graph.findSimilar("Does vitamin D affect bone fractures?", 5);
  assert.ok(hits.length > 0, "lexical fallback should still return hits");
  assert.ok(
    hits[0].atomicAssertion.toLowerCase().includes("vitamin d"),
    "top lexical hit should mention vitamin D",
  );
}

async function testRetireCascadeNeedsReview(): Promise<void> {
  // Build a tiny derivation tree: parent → child. Retiring parent must
  // flip `needsReview = true` on child WITHOUT auto-retiring it.
  const graph = createInMemoryClaimGraph(PROJECT_ID);
  const parent = graph.addClaim(
    makeClaimInput("Aspirin reduces all-cause mortality in elderly adults."),
  );
  const child = graph.addClaim(
    makeClaimInput(
      "Aspirin should be prescribed prophylactically to all adults over 65.",
      {
        derivation: {
          kind: "synthesised",
          parentClaimIds: [parent.id],
          rationale: "Synthesised from primary mortality finding.",
        },
      },
    ),
  );
  const unrelated = graph.addClaim(
    makeClaimInput("CRISPR-Cas9 enables precise genome editing.", {
      derivation: { kind: "user-authored", parentClaimIds: [] },
    }),
  );
  assert.equal(child.needsReview, undefined, "freshly-added child has no flag");

  graph.retireClaim(parent.id);
  const refreshedChild = graph.getClaim(child.id);
  const refreshedUnrelated = graph.getClaim(unrelated.id);
  assert.equal(refreshedChild?.needsReview, true, "child must be flagged for review");
  assert.equal(refreshedChild?.retired, false, "child must NOT be auto-retired");
  assert.equal(
    refreshedUnrelated?.needsReview,
    undefined,
    "unrelated claim untouched",
  );

  // Idempotent: a second retire call should not flip the flag back or duplicate.
  graph.retireClaim(parent.id);
  const reflag = graph.getClaim(child.id);
  assert.equal(reflag?.needsReview, true, "cascade must remain idempotent");
}

async function testSupersedeCascade(): Promise<void> {
  // Supersede is "retire + replace" — descendants of the OLD claim must flip,
  // descendants of the new claim must NOT.
  const graph = createInMemoryClaimGraph(PROJECT_ID);
  const oldFact = graph.addClaim(
    makeClaimInput("Beta-amyloid plaques cause Alzheimer's disease."),
  );
  const refinedFact = graph.addClaim(
    makeClaimInput(
      "Beta-amyloid plaques are associated with Alzheimer's, but tau pathology is the stronger driver.",
    ),
  );
  const childOfOld = graph.addClaim(
    makeClaimInput("Anti-amyloid therapies should reverse cognitive decline.", {
      derivation: { kind: "synthesised", parentClaimIds: [oldFact.id] },
    }),
  );
  const childOfRefined = graph.addClaim(
    makeClaimInput("Tau-targeting drugs are a promising therapeutic avenue.", {
      derivation: { kind: "synthesised", parentClaimIds: [refinedFact.id] },
    }),
  );

  graph.supersede(oldFact.id, refinedFact.id);

  assert.equal(
    graph.getClaim(childOfOld.id)?.needsReview,
    true,
    "child of superseded claim must flip needsReview",
  );
  assert.equal(
    graph.getClaim(childOfRefined.id)?.needsReview,
    undefined,
    "child of replacement claim must NOT flip",
  );
  assert.equal(
    graph.getClaim(oldFact.id)?.supersededBy,
    refinedFact.id,
  );
  assert.ok(
    graph.getClaim(refinedFact.id)?.supersedes.includes(oldFact.id),
  );
}

async function testDeterministicIdsForFirestore(): Promise<void> {
  // Sanity: the deterministic id helpers are pure functions of their inputs.
  // The Firestore adapter relies on this for transactional dedup without
  // querying inside the transaction. We assert the contract here so a
  // mistaken refactor of `ids.ts` fails loudly in CI rather than silently
  // breaking dedup at runtime.
  const h1 = canonicalHash("GLP-1 agonists reduce all-cause mortality in T2DM.");
  const h2 = canonicalHash("GLP-1 agonists reduce all-cause mortality in T2DM.");
  assert.equal(h1, h2, "canonicalHash is pure");
  assert.equal(deterministicClaimId(h1), `clm-${h1}`);
  assert.equal(
    deterministicClaimId(h1),
    deterministicClaimId(h2),
    "same hash ⇒ same claim id",
  );

  const id1 = deterministicContradictionId("clm-a|clm-b|heuristic");
  const id2 = deterministicContradictionId("clm-a|clm-b|heuristic");
  assert.equal(id1, id2, "deterministic contradiction id is pure");
  assert.notEqual(
    id1,
    deterministicContradictionId("clm-a|clm-b|model-veritas"),
    "different detector ⇒ different contradiction id",
  );
  assert.ok(id1.startsWith("ctd-"), "contradiction id keeps the ctd- prefix");
}

async function testVeritasR1BenchRunnerStubFetch(): Promise<void> {
  // Verify the live runner refuses to silently no-op when no endpoint is
  // configured — Phase 3/4 will wire the real URL, until then this is the
  // expected failure mode. CI surfaces the missing deployment immediately.
  const unconfigured = new VeritasR1BenchRunner();
  await assert.rejects(
    () =>
      unconfigured.run({
        id: "smoke",
        suite: "citation",
        difficulty: "easy",
        title: "smoke",
        prompt: "cite",
        context: { claims: [], episodes: [], contradictions: [] },
        expected: { doi: "10.1234/smoke" },
      }),
    /baseUrl not configured/,
    "VeritasR1BenchRunner must refuse to run without baseUrl",
  );

  // With a stubbed fetch we can verify the wire-shape end-to-end without a
  // real Veritas-R1 deployment. Mirrors the Phase 3/4 production transport.
  const stubFetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    assert.ok(url.endsWith("/chat/completions"), `unexpected URL: ${url}`);
    const body = JSON.parse((init?.body as string) ?? "{}");
    assert.equal(body.model, "veritas-r1-chat-14b");
    assert.equal(body.response_format.type, "json_object");
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: JSON.stringify({
                suite: "abstention",
                abstained: true,
                answer: "Insufficient evidence.",
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const runner = new VeritasR1BenchRunner({
    baseUrl: "https://veritas.example/v1",
    apiKey: "stub-key",
    fetchImpl: stubFetch,
  });
  const out = await runner.run({
    id: "abs-smoke",
    suite: "abstention",
    difficulty: "easy",
    title: "abstention smoke",
    prompt: "Answer only if evidence is in memory.",
    context: { claims: [], episodes: [], contradictions: [] },
    expected: { mustAbstain: true, abstentionCues: ["insufficient"] },
  });
  assert.equal(out.suite, "abstention");
  assert.equal(out.abstained, true);

  // renderPrompt is the inspectable surface — assert it does NOT mention
  // Claude / Sonnet / GPT (we explicitly removed third-party model wiring
  // and the system prompt should reflect that).
  const rendered = runner.renderPrompt({
    id: "rp",
    suite: "citation",
    difficulty: "easy",
    title: "render check",
    prompt: "x",
    context: { claims: [], episodes: [], contradictions: [] },
    expected: { doi: "10.1234/x" },
  });
  assert.ok(
    !/claude|sonnet|gpt/i.test(rendered.system),
    "system prompt should not name third-party models",
  );
  assert.ok(
    /Veritas-R1/.test(rendered.system),
    "system prompt should identify the model as Veritas-R1",
  );
}

/* ─────────────────────────────────────────────────────────────
 *  Phase 3 — CP2: Qwen3 chat-template adapter
 *
 *  Production-grade contract:
 *    • Lossless round-trip for what Veritas-R1 emits at inference
 *      (kinds: think | recall | retrieve | verify | tool-call | answer)
 *    • Reasoning prose is plain natural language — matches GPT-5 / Claude /
 *      DeepSeek-R1 / Qwen3 conventions. No prefix syntax.
 *    • `recall` round-trips through a first-class `memory_recall` tool call.
 *    • `decide` and `confidence` are documented lossy fields (UI-only).
 * ──────────────────────────────────────────────────────────── */

/**
 * Build a trace using only kinds Veritas-R1 actually emits at inference. The
 * round-trip MUST be exact for this trace — that's the production contract.
 */
function buildInferenceShapedTrace(): ThoughtTrace {
  const steps: ThoughtStep[] = [
    {
      kind: "think",
      text: "User is asking about GLP-1 mortality. I should recall any prior project claims first.",
      index: 0,
    },
    {
      kind: "recall",
      recalledClaims: ["clm-abc", "clm-def"],
      recalledEpisodes: ["epi-1"],
      index: 1,
    },
    {
      kind: "think",
      text: "I have two prior claims. Need a fresh DOI verification before citing.",
      index: 2,
    },
    {
      kind: "retrieve",
      tool: TOOL_NAMES.retrieve,
      toolInput: { query: "GLP-1 agonists mortality T2DM", limit: 5 },
      toolOutput: { hits: [{ doi: "10.1234/foo", title: "GLP-1 RCT" }] },
      index: 3,
    },
    {
      kind: "verify",
      tool: TOOL_NAMES.verify,
      toolInput: { doi: "10.1234/foo" },
      toolOutput: { resolved: true, journal: "NEJM" },
      index: 4,
    },
    {
      kind: "tool-call",
      tool: "check_claims",
      toolInput: { text: "GLP-1 agonists reduce mortality." },
      toolOutput: { atomicAssertions: ["GLP-1 agonists reduce all-cause mortality"] },
      index: 5,
    },
    {
      kind: "answer",
      text: "GLP-1 agonists reduce all-cause mortality in T2DM patients (NEJM, doi:10.1234/foo).",
      index: 6,
    },
  ];
  return { steps };
}

function assertStepsEqualModuloIndex(
  actual: ThoughtStep[],
  expected: ThoughtStep[],
): void {
  assert.equal(
    actual.length,
    expected.length,
    `step count mismatch: got ${actual.length}, expected ${expected.length}`,
  );
  for (let i = 0; i < expected.length; i++) {
    const a = { ...actual[i], index: 0 };
    const e = { ...expected[i], index: 0 };
    assert.deepEqual(a, e, `step ${i} differs:\n  got=${JSON.stringify(a)}\n  exp=${JSON.stringify(e)}`);
  }
  // Output indexes must be 0..N-1 contiguous — parser contract.
  for (let i = 0; i < actual.length; i++) {
    assert.equal(actual[i].index, i, `step ${i} index should be ${i}, got ${actual[i].index}`);
  }
}

async function testChatTemplateRoundTripInferenceShape(): Promise<void> {
  const trace = buildInferenceShapedTrace();
  const messages = traceToChatML(trace, {
    userInput: "Do GLP-1 agonists reduce mortality in T2DM?",
    mode: "reasoning",
  });

  // Structural checks first.
  assert.equal(messages[0].role, "system");
  assert.equal(messages[1].role, "user");
  assert.equal(
    messages[1].content,
    "Do GLP-1 agonists reduce mortality in T2DM?",
  );

  // recall + retrieve + verify + tool-call ⇒ four tool messages.
  const toolMessages = messages.filter((m) => m.role === "tool");
  assert.equal(toolMessages.length, 4, "every tool-bearing step (incl. recall) emits a tool message");

  // memory_recall is now a first-class tool call — verify by name.
  const recallCalls = messages.flatMap((m) =>
    m.role === "assistant" && m.tool_calls
      ? m.tool_calls.filter((tc) => tc.function.name === TOOL_NAMES.memoryRecall)
      : [],
  );
  assert.equal(recallCalls.length, 1, "recall step must surface as a memory_recall tool call");

  // Reasoning content must be plain prose — no prefix syntax artefacts.
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    const rc = (m as AssistantMessage).reasoning_content;
    if (!rc) continue;
    assert.ok(
      !/^(think|decide|recall):/m.test(rc),
      `reasoning_content must not contain prefix syntax — got: ${rc.slice(0, 60)}`,
    );
  }

  // Every assistant tool_call must have a matching tool message.
  const toolCallIds = new Set<string>();
  for (const m of messages) {
    if (m.role === "assistant" && m.tool_calls) {
      for (const tc of m.tool_calls) toolCallIds.add(tc.id);
    }
  }
  for (const tm of toolMessages) {
    assert.ok(
      toolCallIds.has(tm.tool_call_id),
      `tool message ${tm.tool_call_id} has no matching assistant call`,
    );
  }

  // Lossless round-trip on the inference shape.
  const recovered = chatMLToTrace(messages);
  assertStepsEqualModuloIndex(recovered.steps, trace.steps);

  for (const s of recovered.steps) {
    assert.ok(
      isWellFormedStep(s),
      `recovered step ${s.index} (${s.kind}) failed isWellFormedStep`,
    );
  }
}

async function testChatTemplateLightningStripsReasoning(): Promise<void> {
  // Lightning mode: chat-style training data, no reasoning content.
  const trace = buildInferenceShapedTrace();
  const messages = traceToChatML(trace, {
    userInput: "Quick question.",
    mode: "lightning",
  });
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    assert.equal(
      (m as AssistantMessage).reasoning_content,
      undefined,
      "lightning mode must strip reasoning_content",
    );
  }
  // Final answer must still be present.
  const last = messages[messages.length - 1];
  assert.equal(last.role, "assistant");
  assert.ok((last as AssistantMessage).content.length > 0);
}

async function testChatTemplateSystemPromptOverride(): Promise<void> {
  const trace: ThoughtTrace = {
    steps: [{ kind: "answer", text: "ok", index: 0 }],
  };
  const custom = "You are a custom Veritas variant.";
  const messages = traceToChatML(trace, {
    userInput: "ping",
    systemPrompt: custom,
  });
  assert.equal(messages[0].role, "system");
  assert.equal(messages[0].content, custom);
}

async function testChatTemplateDecideCollapsesToThink(): Promise<void> {
  // `decide` is a UI-only annotation — the trained model never emits it.
  // On round-trip, decide collapses to think; this is documented lossy.
  const trace: ThoughtTrace = {
    steps: [
      { kind: "decide", text: "Cite this paper.", index: 0 },
      { kind: "answer", text: "done", index: 1 },
    ],
  };
  const recovered = chatMLToTrace(
    traceToChatML(trace, { userInput: "x", mode: "reasoning" }),
  );
  assert.equal(recovered.steps.length, 2);
  assert.equal(
    recovered.steps[0].kind,
    "think",
    "decide must collapse to think on the wire format",
  );
  assert.equal(recovered.steps[0].text, "Cite this paper.");
}

async function testChatTemplateConfidenceIsLossyByDesign(): Promise<void> {
  // confidence is wire-format-lossy by design — see file header. Verify.
  const trace: ThoughtTrace = {
    steps: [
      { kind: "think", text: "test", index: 0, confidence: 0.85 },
      { kind: "answer", text: "done", index: 1 },
    ],
  };
  const recovered = chatMLToTrace(
    traceToChatML(trace, { userInput: "x", mode: "reasoning" }),
  );
  assert.equal(
    recovered.steps[0].confidence,
    undefined,
    "confidence must be dropped on round-trip (production-grade contract)",
  );
  // Text must still survive — only confidence is lossy.
  assert.equal(recovered.steps[0].text, "test");
}

async function testChatTemplateMultipleThinkParagraphs(): Promise<void> {
  // Multi-paragraph reasoning must round-trip as multiple think steps. We
  // separate paragraphs by blank lines (\n\n) inside reasoning_content.
  const trace: ThoughtTrace = {
    steps: [
      { kind: "think", text: "First, recall what we know.", index: 0 },
      { kind: "think", text: "Second, plan the verification.", index: 1 },
      { kind: "answer", text: "ok", index: 2 },
    ],
  };
  const messages = traceToChatML(trace, { userInput: "x", mode: "reasoning" });
  // Single assistant turn with multi-paragraph reasoning_content.
  const assistantMsgs = messages.filter((m) => m.role === "assistant");
  assert.equal(assistantMsgs.length, 1);
  const rc = (assistantMsgs[0] as AssistantMessage).reasoning_content;
  assert.ok(rc?.includes("\n\n"), "paragraphs must be blank-line separated");

  // Round-trip recovers two distinct think steps.
  const recovered = chatMLToTrace(messages);
  assert.equal(recovered.steps.length, 3);
  assert.equal(recovered.steps[0].kind, "think");
  assert.equal(recovered.steps[1].kind, "think");
  assert.equal(recovered.steps[0].text, "First, recall what we know.");
  assert.equal(recovered.steps[1].text, "Second, plan the verification.");
}

async function testChatTemplateMemoryRecallToolPayload(): Promise<void> {
  // The recall tool's call carries an optional query; its result carries
  // the recalled ids. Verify the payload shape — CP14 wires the tool def
  // into vLLM with this exact contract.
  const trace: ThoughtTrace = {
    steps: [
      {
        kind: "recall",
        text: "prior aspirin findings",
        recalledClaims: ["clm-x"],
        recalledEpisodes: [],
        index: 0,
      },
      { kind: "answer", text: "done", index: 1 },
    ],
  };
  const messages = traceToChatML(trace, { userInput: "x", mode: "reasoning" });
  const callMsg = messages.find(
    (m) => m.role === "assistant" && m.tool_calls?.[0]?.function.name === TOOL_NAMES.memoryRecall,
  ) as AssistantMessage;
  assert.ok(callMsg, "memory_recall call must be emitted");
  const args = JSON.parse(callMsg.tool_calls![0].function.arguments);
  assert.equal(args.query, "prior aspirin findings");

  const resultMsg = messages.find(
    (m) => m.role === "tool" && m.name === TOOL_NAMES.memoryRecall,
  );
  assert.ok(resultMsg);
  const result = JSON.parse((resultMsg as { content: string }).content);
  assert.deepEqual(result.claims, ["clm-x"]);
  assert.deepEqual(result.episodes, []);
}

async function testChatTemplateUnknownToolBecomesGenericToolCall(): Promise<void> {
  // If serving introduces a new tool the parser doesn't know, the resulting
  // step must default to `tool-call` (not silently dropped).
  const messages: ChatMessage[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "u" },
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "tc-0",
          type: "function",
          function: { name: "exotic_new_tool", arguments: '{"x":1}' },
        },
      ],
    },
    { role: "tool", tool_call_id: "tc-0", name: "exotic_new_tool", content: '{"ok":true}' },
    { role: "assistant", content: "answer" },
  ];
  const recovered = chatMLToTrace(messages);
  assert.equal(recovered.steps.length, 2);
  assert.equal(recovered.steps[0].kind, "tool-call");
  assert.equal(recovered.steps[0].tool, "exotic_new_tool");
  assert.equal(recovered.steps[1].kind, "answer");
}

async function testChatTemplateDeterministicToolCallIds(): Promise<void> {
  // Same trace → identical message array. Required for dataset dedup at CP5.
  const trace = buildInferenceShapedTrace();
  const a = traceToChatML(trace, { userInput: "x", mode: "reasoning" });
  const b = traceToChatML(trace, { userInput: "x", mode: "reasoning" });
  assert.deepEqual(a, b, "tool-call ids must be deterministic across calls");
}

/* ─────────────────────────────────────────────────────────────
 *  Phase 3 — CP3: Episode-log → SFT JSONL exporter
 *
 *  Two checks:
 *    1. Pure-TS Episode → SFTExample → recovered ThoughtTrace, lossless on
 *       inference shape (kinds the model actually emits at run time).
 *    2. The Python exporter's emitted shards parse cleanly through the TS
 *       validator. We read the on-disk fixture (committed in
 *       `veritas/training/tests/fixtures/`) and run each example past
 *       `validateSFTExample` to assert wire-format parity.
 * ──────────────────────────────────────────────────────────── */

function makeRichEpisodeFixture(): {
  episode: Episode;
  claims: Record<string, Claim>;
} {
  const trace: ThoughtTrace = {
    steps: [
      {
        kind: "think",
        text: "User asks about GLP-1 mortality. Recall first.",
        index: 0,
      },
      {
        kind: "recall",
        text: "GLP-1 mortality T2DM",
        recalledClaims: ["clm-glp1"],
        recalledEpisodes: [],
        index: 1,
      },
      {
        kind: "retrieve",
        tool: TOOL_NAMES.retrieve,
        toolInput: { query: "GLP-1 mortality" },
        toolOutput: { hits: [{ doi: "10.1/foo" }] },
        index: 2,
      },
      {
        kind: "verify",
        tool: TOOL_NAMES.verify,
        toolInput: { doi: "10.1/foo" },
        toolOutput: { resolved: true },
        index: 3,
      },
      {
        kind: "answer",
        text: "Yes — see doi:10.1/foo.",
        index: 4,
      },
    ],
  };
  const episode: Episode = {
    id: "epi-x",
    projectId: "proj-x",
    userId: "user-x",
    timestamp: "2026-04-26T00:00:00.000Z",
    type: "query",
    input: "Do GLP-1 agonists reduce mortality?",
    output: "Yes — see doi:10.1/foo.",
    thoughtTrace: trace,
    claimsReferenced: ["clm-glp1"],
    claimsCreated: [],
    claimsRetired: [],
    contradictionIds: [],
  };
  const claims: Record<string, Claim> = {
    "clm-glp1": {
      id: "clm-glp1",
      projectId: "proj-x",
      userId: "user-x",
      canonicalHash: "abc",
      atomicAssertion: "GLP-1 agonists reduce all-cause mortality in T2DM.",
      text: "GLP-1 agonists reduce all-cause mortality in T2DM.",
      polarity: "asserts",
      assertiveness: "direct",
      extractorCertainty: "high",
      sourceSupport: "strong",
      scope: {},
      attributions: [],
      entities: [],
      contradicts: [],
      supersedes: [],
      retired: false,
      createdAt: "2026-04-15T00:00:00.000Z",
      updatedAt: "2026-04-15T00:00:00.000Z",
    },
  };
  return { episode, claims };
}

async function testCP3EpisodeToSFTExampleRoundTrip(): Promise<void> {
  const { episode, claims } = makeRichEpisodeFixture();
  const ex = episodeToSFTExample(episode, { claimsById: claims });
  assert.ok(ex, "rich episode must convert");
  assert.equal(ex!.id, "epi-x");
  assert.equal(ex!.project_id, "proj-x");
  assert.equal(ex!.schema_version, SFT_SCHEMA_VERSION);
  assert.equal(ex!.mode, "deep", "tool-bearing trace ⇒ deep mode");
  assert.deepEqual(ex!.citations, ["clm-glp1"]);
  assert.equal(
    ex!.claims_context["clm-glp1"],
    "GLP-1 agonists reduce all-cause mortality in T2DM.",
  );
  assert.ok(ex!.tokens_estimate > 0);

  // Round-trip — the recovered trace's last step must be the same answer.
  const recovered = chatMLToTrace(ex!.messages);
  assert.equal(recovered.steps[recovered.steps.length - 1].kind, "answer");
  assert.equal(
    recovered.steps[recovered.steps.length - 1].text,
    "Yes — see doi:10.1/foo.",
  );
  // recall step's query text must survive (regression guard for the bug
  // caught during CP3 implementation).
  const recallStep = recovered.steps.find((s) => s.kind === "recall");
  assert.ok(recallStep);
  assert.equal(recallStep!.text, "GLP-1 mortality T2DM");

  // Validator passes.
  const err = validateSFTExample(ex);
  assert.equal(err, null, `validator rejected fresh example: ${err}`);
}

async function testCP3LightningInferenceWhenNoTrace(): Promise<void> {
  const ep: Episode = {
    id: "epi-light",
    projectId: "p",
    userId: "u",
    timestamp: "2026-04-26T00:00:00.000Z",
    type: "query",
    input: "What's the deadline?",
    output: "April 30.",
    claimsReferenced: [],
    claimsCreated: [],
    claimsRetired: [],
    contradictionIds: [],
  };
  const ex = episodeToSFTExample(ep, { claimsById: {} });
  assert.ok(ex);
  assert.equal(ex!.mode, "lightning");
  // Lightning answer message has no reasoning_content.
  for (const m of ex!.messages) {
    if (m.role !== "assistant") continue;
    assert.equal((m as AssistantMessage).reasoning_content, undefined);
  }
}

async function testCP3DropEmptyInput(): Promise<void> {
  const bad: Episode = {
    id: "epi-bad",
    projectId: "p",
    userId: "u",
    timestamp: "2026-04-26T00:00:00.000Z",
    type: "query",
    input: "   ",
    claimsReferenced: [],
    claimsCreated: [],
    claimsRetired: [],
    contradictionIds: [],
  };
  assert.equal(episodeToSFTExample(bad, { claimsById: {} }), undefined);
}

async function testCP3InferModeMatrix(): Promise<void> {
  // Lightning: no trace
  assert.equal(inferMode(undefined), "lightning");
  // Lightning: only an answer step, no thinking
  assert.equal(
    inferMode({ steps: [{ kind: "answer", text: "x", index: 0 }] }),
    "lightning",
  );
  // Reasoning: thinking-only
  assert.equal(
    inferMode({
      steps: [
        { kind: "think", text: "x", index: 0 },
        { kind: "answer", text: "y", index: 1 },
      ],
    }),
    "reasoning",
  );
  // Deep: any tool call
  assert.equal(
    inferMode({
      steps: [
        {
          kind: "retrieve",
          tool: "retrieve",
          toolInput: {},
          toolOutput: {},
          index: 0,
        },
        { kind: "answer", text: "y", index: 1 },
      ],
    }),
    "deep",
  );
  // Deep: > 5 think steps
  const longThink: ThoughtStep[] = Array.from({ length: 6 }, (_, i) => ({
    kind: "think" as const,
    text: `t${i}`,
    index: i,
  }));
  longThink.push({ kind: "answer", text: "x", index: 6 });
  assert.equal(inferMode({ steps: longThink }), "deep");
}

async function testCP3TokenEstimateScales(): Promise<void> {
  const small: ChatMessage[] = [
    { role: "system", content: "s" },
    { role: "user", content: "u" },
    { role: "assistant", content: "ok" },
  ];
  const large: ChatMessage[] = [
    { role: "system", content: "s".repeat(200) },
    { role: "user", content: "u".repeat(400) },
    {
      role: "assistant",
      content: "ans",
      reasoning_content: "x".repeat(2000),
    },
  ];
  assert.ok(estimateTokens(large) > estimateTokens(small) * 10);
}

async function testCP3ValidatorRejectsBadShapes(): Promise<void> {
  assert.ok(validateSFTExample(null));
  assert.ok(validateSFTExample({}));
  assert.ok(
    validateSFTExample({
      id: "x",
      project_id: "p",
      schema_version: "v0",
      mode: "reasoning",
      messages: [{ role: "user", content: "u" }],
      citations: [],
      claims_context: {},
      tokens_estimate: 1,
      created_at: "x",
    }),
    "must reject wrong schema version",
  );
  // Wrong shape — messages array missing.
  assert.ok(
    validateSFTExample({
      id: "x",
      project_id: "p",
      schema_version: SFT_SCHEMA_VERSION,
      mode: "lightning",
      citations: [],
      claims_context: {},
      tokens_estimate: 1,
      created_at: "x",
    }),
    "must reject when messages missing",
  );
}

async function testCP3PythonExporterShardsParseInTS(): Promise<void> {
  // The most important CP3 check: real shards emitted by the Python exporter
  // must parse through the TS validator without loss. We invoke the Python
  // exporter inline against the committed fixture, then read back the JSONL.
  //
  // Skipped (with a warning) when Python isn't available — the local Python
  // tests already cover end-to-end on the Python side.
  const { execFileSync } = await import("node:child_process");
  const pythonCandidates = ["python", "python3", "py", "/c/Python314/python"];
  let pythonBin: string | undefined;
  for (const cand of pythonCandidates) {
    try {
      execFileSync(cand, ["--version"], { stdio: "ignore" });
      pythonBin = cand;
      break;
    } catch { /* try next */ }
  }
  if (!pythonBin) {
    console.warn("    (skipping cross-runtime parity check — no Python found)");
    return;
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = path.resolve(__dirname, "../../../../");
  const fixturePath = path.join(
    repoRoot,
    "veritas/training/tests/fixtures/episodes_fixture.json",
  );
  const tmpOut = fs.mkdtempSync(path.join(repoRoot, "src/lib/veritas/__tests__/.cp3-"));
  try {
    // Make src importable in Python via PYTHONPATH.
    const env = {
      ...process.env,
      PYTHONPATH: path.join(repoRoot, "veritas/training/src"),
    };
    execFileSync(
      pythonBin,
      [
        "-m",
        "forge_veritas.data.firestore_export",
        "--source",
        "fixture",
        "--fixture",
        fixturePath,
        "--out",
        tmpOut,
        "--shard-size",
        "1",
        "--run-id",
        "ts-parity-test",
      ],
      { env, stdio: ["ignore", "ignore", "ignore"] },
    );

    const runDir = path.join(tmpOut, "ts-parity-test");
    const shardFiles = fs
      .readdirSync(runDir)
      .filter((f) => f.startsWith("shard-") && f.endsWith(".jsonl"))
      .sort();
    assert.ok(shardFiles.length >= 1, "exporter must produce at least one shard");

    let totalExamples = 0;
    for (const sf of shardFiles) {
      const raw = fs.readFileSync(path.join(runDir, sf), "utf-8");
      const lines = raw.split("\n").filter((l) => l.length > 0);
      for (const line of lines) {
        const parsed = JSON.parse(line) as SFTExample;
        const err = validateSFTExample(parsed);
        assert.equal(
          err,
          null,
          `validator rejected Python-exported example: ${err}`,
        );
        // Stronger: round-trip the messages — recovered trace must end in answer.
        const recovered = chatMLToTrace(parsed.messages);
        assert.ok(
          recovered.steps.length > 0,
          `Python shard ${sf} produced an empty trace on TS round-trip`,
        );
        assert.equal(
          recovered.steps[recovered.steps.length - 1].kind,
          "answer",
        );
        totalExamples++;
      }
    }
    assert.ok(totalExamples >= 1, "must round-trip at least one example");
  } finally {
    fs.rmSync(tmpOut, { recursive: true, force: true });
  }
}

export async function main(): Promise<number> {
  console.log("Veritas Phase 1 + 2 + 3 (CP2-CP3) — integration test");
  const cases: TestCase[] = [
    { name: "AsyncClaimGraph round-trip (add/dedup/supersede/contradiction/links)", run: testAsyncClaimGraphRoundTrip },
    { name: "AsyncEpisodeLog round-trip (append/list/recent/ofType/forClaim/search/clear)", run: testAsyncEpisodeLogRoundTrip },
    { name: "Firestore converters round-trip (claim/link/contradiction/episode + stripUndefined)", run: testFirestoreConverterRoundTrip },
    { name: "MockBenchRunner pipeline (oracle passes, zero fails, never malformed)", run: testMockBenchRunnerOracle },
    { name: "Phase 2 — embedding-backed findSimilar (cosine + L2-normalised)", run: testEmbeddingBackedFindSimilar },
    { name: "Phase 2 — findSimilar lexical fallback (no embedder wired)", run: testFindSimilarLexicalFallback },
    { name: "Phase 2 — retire cascade flips needsReview on descendants", run: testRetireCascadeNeedsReview },
    { name: "Phase 2 — supersede cascade only off the OLD claim", run: testSupersedeCascade },
    { name: "Phase 2 — deterministic ids are pure functions of inputs", run: testDeterministicIdsForFirestore },
    { name: "Phase 2 — VeritasR1BenchRunner errors loud + parses stub responses", run: testVeritasR1BenchRunnerStubFetch },
    { name: "Phase 3 CP2 — chat-template round-trip on inference shape", run: testChatTemplateRoundTripInferenceShape },
    { name: "Phase 3 CP2 — lightning mode strips reasoning", run: testChatTemplateLightningStripsReasoning },
    { name: "Phase 3 CP2 — system prompt override", run: testChatTemplateSystemPromptOverride },
    { name: "Phase 3 CP2 — decide collapses to think (lossy by design)", run: testChatTemplateDecideCollapsesToThink },
    { name: "Phase 3 CP2 — confidence dropped on wire (lossy by design)", run: testChatTemplateConfidenceIsLossyByDesign },
    { name: "Phase 3 CP2 — multiple think paragraphs round-trip", run: testChatTemplateMultipleThinkParagraphs },
    { name: "Phase 3 CP2 — memory_recall tool payload shape", run: testChatTemplateMemoryRecallToolPayload },
    { name: "Phase 3 CP2 — unknown tool becomes generic tool-call", run: testChatTemplateUnknownToolBecomesGenericToolCall },
    { name: "Phase 3 CP2 — deterministic tool-call ids", run: testChatTemplateDeterministicToolCallIds },
    { name: "Phase 3 CP3 — Episode → SFTExample round-trip (rich)", run: testCP3EpisodeToSFTExampleRoundTrip },
    { name: "Phase 3 CP3 — lightning mode inferred when no trace", run: testCP3LightningInferenceWhenNoTrace },
    { name: "Phase 3 CP3 — drop episodes with empty input", run: testCP3DropEmptyInput },
    { name: "Phase 3 CP3 — inferMode matrix", run: testCP3InferModeMatrix },
    { name: "Phase 3 CP3 — token estimate scales with content", run: testCP3TokenEstimateScales },
    { name: "Phase 3 CP3 — validator rejects bad shapes", run: testCP3ValidatorRejectsBadShapes },
    { name: "Phase 3 CP3 — Python exporter shards parse in TS (cross-runtime parity)", run: testCP3PythonExporterShardsParseInTS },
  ];
  const failures = await runAll(cases);
  if (failures === 0) {
    console.log(`\nAll ${cases.length} cases passed.`);
  } else {
    console.error(`\n${failures} / ${cases.length} cases FAILED.`);
  }
  return failures;
}

// Execute when run directly (node --import tsx, tsx, ts-node, or node 22+ native TS).
// `require.main === module` isn't available in ESM; using import.meta.url is the
// ESM-native equivalent. Falls back silently if neither is present.
const isDirectRun =
  (typeof require !== "undefined" &&
    typeof module !== "undefined" &&
    (require as unknown as { main?: unknown }).main === module) ||
  (typeof import.meta !== "undefined" &&
    typeof process !== "undefined" &&
    process.argv[1] !== undefined &&
    import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/")));

if (isDirectRun) {
  main().then((failures) => {
    process.exit(failures === 0 ? 0 : 1);
  });
}
