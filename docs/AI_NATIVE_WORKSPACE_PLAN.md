# Forge → AI-Native Workspace — Execution Plan (v4)

> Status: **active.** Decisions locked: **full research purge** + flagship
> **Living Pages** (concept being refined). Backend pivots to serve it.

## 0. Direction

Forge becomes a **lean, general AI-native workspace** judged by **autonomy,
comfort, speed**. The research/verification subsystem is being removed entirely,
and the backend re-pointed at a single novel capability: **Living Pages**.

Competitive scan (May 2026) confirmed: the category converged on agents,
auto-organization, Q&A, and multi-format generation. "Self-updating documents"
exists only in **publishing/docs/KB** niches (GitBook sync, Code-to-Docs, living
style guides) and experiments (Karpathy's wiki). **No one ships autonomous,
self-maintaining synthesis as a general personal-workspace primitive.** That is
the lane.

## 1. Target surface (keep / remove)

**Keep (general workspace):** Projects, Documents/editor, Research chat (general
AI assistant), Calendar (general scheduling), Activity, Teams, Settings, ⌘K.

**Remove (research/verification machinery — the "full purge"):**
- **Pulse** — assertion freshness + refactors (`/pulse`, `/api/pulse/*`,
  `usePulseWorkspace`, `useFreshnessScan`, `lib/firestore/pulse`,
  `forge-graph/adapters/pulse-blocks`).
- **Checks** — in-editor contradiction/claim checking (`/api/ai/check-claims`,
  `useDocContradictions`, `useProjectContradictions`, `ClaimCheckPanel`,
  `ContradictionBanner`, claim pills / `ClaimMention`).
- **Sync** — conflicts/constraints/invariants (`/sync`, `SyncProvider`).
- **Echo** — semantic reactivity (`useSemanticReactivity`, `SemanticFlash`,
  Echo bell/tray, `/api/forge-graph/semantic-check`).
- **forge-graph reasoning** + **Tempo** agent + impact-simulator **Preview** —
  the claim/graph reasoning layer, once nothing general depends on it.
- `/api/ai/write`'s research framing → folded into the new backend.

**Dependency note (why this is sequenced, not one delete):** `CalendarProvider`
and `SyncProvider` import Pulse; `forge-graph/builder` uses `pulse-blocks`;
`forge-graph` is shared by Tempo/Calendar/Echo; `semantic-check` is shared by
Echo. Each removal must untangle these and stay green.

## 2. Purge sequence (each checkpoint ends green: tsc + lint + build)

- **P0 — De-link (DONE this checkpoint).** Remove Pulse/Checks(Sync)/Preview
  from sidebar, mobile nav, and the ⌘K command set. Routes still exist
  transiently; the workspace *surface* is already lean.
- **P1 — Editor de-research.** Strip Checks from the editor (ContradictionBanner,
  ClaimCheckPanel, `useDocContradictions`, claim pills) + delete `check-claims`.
- **P2 — Remove Sync** (routes + `SyncProvider`); untangle Calendar's Pulse dep.
- **P3 — Remove Pulse** (routes/APIs/hooks/lib/adapter).
- **P4 — Remove Echo** (reactivity, flash, bell/tray, `semantic-check`).
- **P5 — Remove forge-graph reasoning / Tempo / Preview** once orphaned; prune
  onboarding (Tutorial) + landing copy of research framing.

## 3. Backend pivot (after the surface is lean)

Replace the claim/freshness/contradiction backend with a **Living Pages service**:
- **Content model:** every page can be `static` or `living` (`spec` = the
  intent, `sources` = scope, `lastSynthesisAt`, `revision`).
- **Synthesis worker:** on relevant change (debounced) or on demand, gather the
  semantically-relevant workspace content (surgical embeddings via the existing
  embed endpoint) and have Groq **rewrite/reconcile** the page, preserving the
  user's edits where possible.
- **Speed:** incremental (only re-synthesize affected sections), cached by
  content hash, streamed.
- Reuse the Groq + auth + rate-limit helpers. No store-everything vectors.

## 4. Flagship: Living Pages (REFINING — open design choices)

A page defined by *intent* that Forge keeps synthesized and current autonomously.
Open questions to lock the concept (pending user steer):

1. **Trigger / autonomy level** — fully autonomous background refresh, vs. "stale"
   badge + one-tap refresh, vs. on-open refresh? (comfort vs. control)
2. **Scope of integration** — whole workspace, a chosen project, or explicit
   linked sources?
3. **Edit reconciliation** — may it rewrite text the user hand-edited, or only
   append/update AI-owned regions? (trust)
4. **Granularity** — a whole living *page*, or living *blocks* embeddable in any
   doc?

## 5. Out of scope

Autonomous task-agents, ANN/vector index, multi-modal, the unbuilt
Veritas/Forge-SAI model.
