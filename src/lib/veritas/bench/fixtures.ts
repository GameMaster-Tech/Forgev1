/**
 * ForgeBench-Reason — fixture builders.
 *
 * Suite authors need to hand-craft tiny project states (a handful of claims,
 * a contradiction pair, a scope disagreement). These helpers keep the suite
 * files short and force every fixture to be schema-complete so the grader
 * never trips on missing fields.
 */

import type {
  Claim,
  ClaimScope,
  Contradiction,
  ContradictionSignal,
  ContradictionStatus,
  Episode,
  EpisodeType,
  Polarity,
  SourceAttribution,
  SourceSupport,
} from "../memory/schema";
import { canonicalHash } from "../memory/ids";

export interface ClaimFixture {
  id: string;
  atomic: string;
  polarity?: Polarity;
  sourceSupport?: SourceSupport;
  scope?: ClaimScope;
  entities?: string[];
  attributions?: SourceAttribution[];
  topicId?: string;
}

export function buildClaim(projectId: string, f: ClaimFixture): Claim {
  const now = "2026-04-01T00:00:00.000Z";
  return {
    id: f.id,
    projectId,
    userId: "u-bench",
    canonicalHash: canonicalHash(f.atomic),
    text: f.atomic,
    atomicAssertion: f.atomic,
    polarity: f.polarity ?? "asserts",
    assertiveness: "direct",
    extractorCertainty: "high",
    sourceSupport: f.sourceSupport ?? "moderate",
    scope: f.scope ?? {},
    attributions: f.attributions ?? [],
    entities: f.entities ?? [],
    contradicts: [],
    supersedes: [],
    retired: false,
    createdAt: now,
    updatedAt: now,
    topicId: f.topicId,
  };
}

export interface EpisodeFixture {
  id: string;
  type: EpisodeType;
  input: string;
  output?: string;
  claimsReferenced?: string[];
  claimsCreated?: string[];
  claimsRetired?: string[];
  contradictionIds?: string[];
  timestamp?: string;
}

export function buildEpisode(projectId: string, f: EpisodeFixture): Episode {
  return {
    id: f.id,
    projectId,
    userId: "u-bench",
    timestamp: f.timestamp ?? "2026-04-01T00:00:00.000Z",
    type: f.type,
    input: f.input,
    output: f.output,
    claimsReferenced: f.claimsReferenced ?? [],
    claimsCreated: f.claimsCreated ?? [],
    claimsRetired: f.claimsRetired ?? [],
    contradictionIds: f.contradictionIds ?? [],
  };
}

export interface ContradictionFixture {
  id: string;
  a: string;
  b: string;
  signals?: ContradictionSignal[];
  score?: number;
  status?: ContradictionStatus;
}

export function buildContradiction(projectId: string, f: ContradictionFixture): Contradiction {
  const now = "2026-04-01T00:00:00.000Z";
  return {
    id: f.id,
    projectId,
    a: f.a,
    b: f.b,
    detector: "heuristic",
    signals: f.signals ?? ["opposite-polarity"],
    score: f.score ?? 0.7,
    status: f.status ?? "open",
    detectedAt: now,
    updatedAt: now,
  };
}
