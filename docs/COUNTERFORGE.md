# Counterforge

Forge's adversarial-review engine. A second voice that lives inside
your project, built from your own sources, whose only job is to
**argue against your draft**.

While you write, Counterforge:

1. Identifies the load-bearing claims in your active documents.
2. For each claim, searches your project corpus for evidence that
   contradicts, qualifies, or weakens it.
3. Synthesises the strongest 2-3 sentence counter-argument it can,
   citing those sources.
4. Presents the claim and the counter side-by-side with three actions:
   **Refute**, **Concede**, **Defer**.
5. Maintains a single **Readiness** number — what fraction of your
   load-bearing claims has actually survived contact with a counter.

It is peer review at draft time, from inside your own evidence base.

---

## Why nobody has this

| System | What they do | What's missing |
| --- | --- | --- |
| Claude | Counter-arguments on request | No persistent, source-grounded skeptic running alongside the draft |
| ChatGPT | Same — reactive, one-shot | Same |
| Gemini | Same | Same |
| Notion | No reasoning | Everything |
| Word + reviewers | Peer comments | Arrives months too late |

Closest analogue is peer review — except peer review happens after
submission, when fixes are expensive and rejection is unrecoverable.
Counterforge moves the same critical eye to draft time, when the cost
of fixing a weak argument is minutes instead of months.

---

## Architecture

```
                 ┌─────────────────────────┐
                 │   scanProject()         │
                 └────────────┬────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
   ┌─────────┐         ┌──────────────┐      ┌──────────────┐
   │ docs    │         │ veritasClaims│      │recallSnippets│
   └─────────┘         └──────────────┘      └──────────────┘
        │                     │                     │
        └────────────┬────────┴─────────────────────┘
                     │
       ┌─────────────▼─────────────┐
       │  extractLoadBearingClaims │
       └─────────────┬─────────────┘
                     │
                     ▼
       ┌──────────────────────────┐
       │  findCounterEvidence     │  ← polarity-flipped retrieval
       │   • topic overlap         │
       │   • negation alignment    │
       │   • qualifier patterns    │
       └─────────────┬────────────┘
                     │
                     ▼
       ┌──────────────────────────┐
       │ synthesiseCounterArgument│  ← deterministic template today,
       └─────────────┬────────────┘    swap for Veritas-R1 when ready
                     │
                     ▼
       ┌──────────────────────────┐
       │   /counterforgeCases     │
       └──────────────────────────┘
```

### Three pieces

- **`detect.ts`** — pure heuristic functions for extraction +
  retrieval + synthesis. No I/O.
- **`firestore.ts`** — CRUD on `counterforgeCases` and `counterforgeSettings`.
- **`scan.ts`** — orchestrator: fetches inputs, runs detectors,
  dedupes by fingerprint, persists new cases, marks stale on edit.

### Counter-evidence scoring

A candidate counter rises through three signals:

```
score = 0.6 · topicOverlap(jaccard)
      + 0.25 · polarityFlip
      + 0.10 · qualifierPatternHit     (replication failure, retraction…)
```

Anything with `topicOverlap < 0.10` is dropped. The surface threshold
is per-project (default 0.45) — below it, the case isn't worth
surfacing.

### Fingerprinting + stale handling

Each case has a deterministic FNV-1a fingerprint of the canonical
claim form. Re-running the scan finds existing cases instantly. When
the user edits the draft and a claim disappears, the orchestrator
marks the open case `stale` — visible but excluded from the readiness
denominator until the user re-scans.

---

## Schema

```ts
interface CounterCase {
  id: string;
  projectId: string;
  ownerId: string;

  claimText: string;           // user's claim, ≤ 240 chars
  claimId?: string;            // optional anchor to veritasClaims
  documentId?: string;
  paragraphIdx?: number;

  counterArgument: string;     // 2-3 sentences
  evidence: CounterEvidence[]; // up to 5 supporting rows
  overallStrength: "weak" | "moderate" | "strong";

  status: "open" | "refuted" | "conceded" | "deferred" | "stale";

  resolution?: string;
  concededCaveat?: string;
  refutationSource?: string;

  fingerprint: string;
  createdAt: Timestamp | number;
  updatedAt: Timestamp | number;
  resolvedAt?: Timestamp | number;
}
```

Per-project settings (`CounterforgeSettings`):

- `autoScanIdleMinutes` — auto-scan after N min idle (0 = manual)
- `surfaceThreshold` — minimum counter-score to surface (default 0.45)
- `skipWellSupported` — skip claims whose `sourceSupport ∈ {strong, consensus}`

---

## Readiness score

A single number a researcher cares about:

```
readiness = (refuted + conceded) / (refuted + conceded + open + deferred)
```

Stale cases are excluded from the denominator until re-scan. Showing
the pct as a gradient bar drives the same psychology as a "75% complete"
indicator: visible progress on something that previously had no end
state.

---

## Why it matters

- Researchers lose grants, get desk-rejected, get torn apart at
  conferences because of arguments they didn't see were weak.
- The bias that hides those weak arguments — confirmation toward your
  own thesis — is unfixable by introspection.
- Counterforge externalises the skeptic, **using your own sources**,
  so the bias is structurally bypassed.

Pre-submission, every claim has one of three states:

- **refuted** — counter was defeated by a stronger source
- **conceded** — a caveat was added inline
- **open / deferred** — visible, fixable before peer review

This is an unfair advantage. Ship stronger papers, every time.

---

## File layout

```
src/lib/counterforge/
├── types.ts            CounterCase, CounterEvidence, ReadinessScore
├── firestore.ts        CRUD + computeReadiness
├── detect.ts           extract / find / synthesise + fingerprint
├── scan.ts             orchestrator + stale marker
└── index.ts            public surface

src/components/counterforge/
├── CounterCaseCard.tsx     one claim ↔ counter pair
└── CounterforgePanel.tsx   the full surface

src/app/(app)/project/[projectId]/counterforge/page.tsx
docs/COUNTERFORGE.md
```

Total: ~1,400 lines including comments + doc. Plugs into existing
collections (`veritasClaims`, `recallSnippets`, `documents`); no new
infrastructure.

---

## Roadmap

- **v1 (shipped)** — heuristic claim extraction, polarity-flipped
  retrieval, template-based synthesis, manual scan.
- **v1.1** — debounced auto-scan after `autoScanIdleMinutes`; toast
  on new high-strength cases.
- **v2** — swap synthesis template for a Veritas-R1 call; keep the
  inputs/outputs identical so callers don't change.
- **v3** — inline rendering inside the TipTap editor: hovering a
  load-bearing sentence in your draft shows a small `[counter]` chip
  if Counterforge has built one; click expands to the side-by-side.
- **v4** — *cross-project skeptic*: opt-in retrieval of counter-
  evidence from your other projects' corpora. Useful for researchers
  whose topics span papers.
