# Forge → AI-Native Reactive Workspace — Execution Plan (v5)

> Status: **active.** Direction locked: a general **AI-Native Workspace** that is
> **reactive** (AI *and* reactive — not just one). P0 de-link committed
> (`d448bc7`). Now: design the feature set, build it, then pivot the backend.

## 0. The paradigm

Forge's edge: **content has dependencies, and AI propagates *meaning* through
them.** Think a spreadsheet's reactive formula graph — but the cells are
free-form knowledge and "recompute" is AI synthesis. No mainstream workspace
does true semantic reactivity over prose (Notion synced-blocks are literal
copies; DB formulas only work on structured fields).

**Forge already owns the engine to do this.** `forge-graph` ("Forge Reactive
Workspace") is a dependency DAG with `upstream/downstreamDependencies`,
`STABLE/CONFLICTED/DRIFTING` status, per-node semantic embeddings, versioned
propagation, and adapters that already turn **documents + editor content** into
nodes. Today it only drives calendar/claims. **We generalize it to all content.**
(This reverses the earlier "purge the engine" plan: we purge the research
*surfaces*, keep + upgrade the *engine*.)

## 1. Feature set (designed now → built next)

### F1 — Reactors  *(novel · flagship)*
A block whose content is **derived by a natural-language rule over sources** and
**recomputes itself when those sources change.**

- You write a rule: `↻ summary of {Atlas notes}`, `↻ open questions across {these
  3 docs}`, `↻ current pricing from {Pricing}`.
- AI computes the derived content; the Reactor records a dependency on its
  sources.
- When a source changes, the Reactor is marked `drifting` and re-synthesizes
  (per the autonomy setting) — **reactive, AI-native, composable.**
- This is the diverse/innovative evolution of "Living Pages": composable derived
  *blocks*, not just whole-page synthesis.

### F2 — Ripples  *(novel · flagship)*
The **push** direction. When you edit content, Forge uses the dependency graph +
semantic similarity to find **downstream content that just went stale** and
surfaces it: *"You changed the launch date here — it's referenced in 3 places."*
One tap reconciles them (AI updates the dependents).

- AI-native: detects *semantic* dependents, reconciles via LLM.
- Reactive: change propagation through the graph.
- Nothing mainstream propagates *meaning* changes across free-form docs.

### Semi — Drift  *(supporting)*
A calm, ambient **reactive-status affordance** reusing the engine's
`STABLE / DRIFTING / CONFLICTED` states: a margin dot/chip on reactive content
showing whether it's current, with one-tap **Reconcile now**. Makes F1 + F2
visible and trustworthy. Small, shared glue.

## 2. Architecture upgrade (the backend pivot)

Generalize `forge-graph` from calendar/claims to **content reactivity**:
- A `reactive/` layer: a `Reactor` model (rule, source refs, last value, source
  hash, status) persisted in Firestore; a dependency index over content.
- **Recompute service** — `POST /api/ai/reactor`: given a rule + resolved source
  text, Groq synthesizes the derived content (HTML fragment). Debounced, cached
  by source-content hash, incremental.
- **Propagation** — on save, embed the changed block (existing embed endpoint),
  find dependents (graph edges + cosine), mark them `drifting` → drives Ripples
  + Drift.
- Reuse Groq + auth + rate-limit helpers and the `forge-graph` adapters
  (`documents`, `tiptap`). Surgical embeddings; no store-everything vectors.
- Fold the research backend (`check-claims`, pulse APIs) out as surfaces are
  removed (P1–P3 below); keep `semantic-check`/embed as reactive primitives.

## 3. Checkpoints (each green: tsc + lint + build; I report)

- **P0 — De-link research surfaces.** DONE (`d448bc7`).
- **R1 — Reactor foundation.** `reactive/types.ts` + `POST /api/ai/reactor`
  recompute endpoint. (This checkpoint.)
- **R2 — Reactor in the editor.** A reactive block node + a hook that resolves
  sources, calls recompute, renders + caches; manual refresh first.
- **R3 — Drift (semi).** Source-hash staleness → `drifting` status + Reconcile
  affordance; then autonomous refresh.
- **R4 — Ripples.** Propagation on save → downstream stale detection + one-tap
  reconcile.
- **R5 — Remove research surfaces' dead code** (Pulse/Checks/Sync routes) now
  that nav is clean; reframe onboarding/landing around reactivity.

## 4. Out of scope (now)

Autonomous task-agents, ANN index, multi-modal, the unbuilt Veritas/Forge-SAI
model, claim extraction in the core path.
