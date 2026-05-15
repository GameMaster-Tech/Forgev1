# Phase 0 — Audit findings & fixes

Audit performed before starting Phase 1. Every issue below is either fixed in
this commit or deliberately deferred with a documented reason.

## Schema-level

| # | Issue | Fix |
|---|---|---|
| 1 | `Contradiction.differentiatingScopeAxis: keyof ClaimScope` accepted `"other"` — a `Record<string,string>` payload, not a scope axis. | Introduced `ClaimScopeAxis` union + `CLAIM_SCOPE_AXES` constant. Field narrowed to `ClaimScopeAxis`. |
| 2 | `OpenAccessStatus` union included `"unknown"` duplicated with optional semantics. | Dropped `"unknown"` — undefined = unknown. |
| 3 | `newSourceRefId(doi)` returned `src-10.1234/abc` with `/` (illegal Firestore doc id). | Added `encodeDoiForId()` — lowercases, strips whitespace, replaces `/` → `_`, filters disallowed chars. |
| 4 | `isClaim` type guard accepted objects with any polarity/assertiveness/support string. | Added `POLARITY_SET`/`ASSERTIVENESS_SET`/etc. membership checks + `scope` presence check + timestamp checks. |

## Claim graph logical bugs

| # | Issue | Fix |
|---|---|---|
| 5 | `addContradiction` accepted contradictions with dangling claim refs, corrupting the denormalised `contradicts[]` list. | Throws on unknown `a`/`b` or self-contradiction (`a === b`). |
| 6 | `supersede(X, X)` retired the live claim in place. | Early return on `oldId === newId`. |
| 7 | Denormalised `contradicts[]` never shrank when a contradiction was dismissed via `updateContradiction`. | `updateContradiction` now detects open↔non-open transitions and adds/removes from `contradicts[]` on both claims. |
| 8 | `updateClaim` didn't re-derive `entities` flat list when `entityRefs` was patched. | `updateClaim` auto-syncs `entities` from `entityRefs` unless the caller explicitly patched `entities`. |
| 9 | `addContradiction` allowed duplicate `(a,b,detector)` entries. | Added `contradictionPairIndex` with canonical pair key — same pair + detector returns the existing record. |
| 10 | `Contradiction` persisted with caller's `(a,b)` ordering — `(x,y)` and `(y,x)` were different records. | Canonicalise to `a < b` before write. |
| 11 | `updateContradiction` didn't append to `statusHistory` on status transitions. | Now auto-appends a `ContradictionStatusChange` on every status transition. |

## Detection heuristics

| # | Issue | Fix |
|---|---|---|
| 12 | `hasAntonymVerb` used naive substring matching — `"raise"` matched inside `"raisers"`. | Moved to word-boundary regex with common inflections (`s/es/ed/d/ing`). |
| 13 | `parseQuantitative` hazard-ratio regex captured `"or"` and `"hr"` as standalone matches — any sentence containing " or " emitted garbage quantitative facts. | Split into two regexes: full-name (`hazard ratio`, etc.) allows loose separator; abbreviation (`hr/or/rr`) requires `:` or `=` to match. |

## Deferred (intentionally)

| # | Issue | Reason |
|---|---|---|
| D1 | `findSimilar` uses lexical Jaccard only. | Phase 0 baseline. Replaced by pgvector in Phase 1. |
| D2 | `verify.ts` hard-coupled to Crossref (falls to `"error"` if Crossref rate-limits). | Phase 1 adds OpenAlex fallback. |
| D3 | Extractor emits `entities: []` always (no entity resolution yet). | Entity linking lands in Phase 2 when we wire a bio-NER model. |
| D4 | `Claim.embeddingRef` is defined but no writer populates it. | Phase 1 wires the embedder (BGE-M3) behind the Firestore writer. |
| D5 | `isoNow()` uses wall clock — not injectable for deterministic tests. | Fixture builders hard-code a deterministic timestamp instead. |

## Verification

- `npx tsc --noEmit` — clean (exit 0).
- `npx eslint src/lib/veritas` — clean (exit 0).
