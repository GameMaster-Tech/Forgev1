# Forge → AI-Native Reactive Workspace — Plan (v6, simplified)

> Status: **active.** Done: P0 de-link (`d448bc7`), R1 Reactor foundation
> (`67da961`). This version *simplifies scope* and *defines the refactors*.

## Simplification (what changed from v5)

1. **One flagship first.** Build **Reactors** end-to-end. **Ripples** and
   **Drift** stay in the vision but are sequenced *after* Reactors ships — not
   built in parallel.
2. **Do NOT rewire `forge-graph`.** Reactors are **self-contained editor nodes**:
   the rule, sources, derived value, and status all live as node attributes
   inside the document. No new Firestore collection, no DAG surgery. We reuse
   only `searchWorkspace`/embed (relevance) + `/api/ai/reactor` (recompute).
3. **State in the document.** A Reactor persists with the doc's content (it's a
   block), so it works with the existing autosave + collab path unchanged.

This makes Reactors a low-risk, additive feature, and the "backend pivot" reduces
to: *add one recompute route (done) + remove the research backend.*

## Reactor — definition (precise)

A **block** in the editor whose body is **derived from a natural-language rule
over sources**, recomputable on demand (auto later).

- **Node attrs:** `id`, `rule` (string), `sources` (ReactorSourceRef[]),
  `value` (HTML), `sourceHash`, `status` (`empty|computing|stable|drifting|error`),
  `computedAt`.
- **Insert:** `/reactor` in the slash menu → empty Reactor block.
- **Configure:** type the rule; pick sources (this doc / other docs in the
  project / whole project). Empty sources = whole project.
- **Compute:** client resolves sources → plain text, posts `{rule, sources}` to
  `/api/ai/reactor`, writes the returned HTML into `value`, stores `sourceHash`,
  sets `status=stable`.
- **Render:** node view shows a header (↻ rule chip + status dot + Refresh) and
  the derived content below.
- **Drift (next phase):** on doc/source change, re-resolve sources; if
  `hashSources` ≠ stored `sourceHash` → `status=drifting`; Refresh recomputes.

## Defined refactors

### A. ADD — Reactors (feature build)
- `src/components/editor/extensions/Reactor/` — Tiptap node (`extension.ts`) +
  React node view (`view.tsx`) with the rule/sources/refresh UI.
- `src/hooks/useReactor.ts` — resolve sources (reuse `getDocument` /
  `searchWorkspace`), call `/api/ai/reactor`, update node attrs, compute drift
  via `hashSources`.
- Register the node in `ForgeEditor.tsx` extensions; add a `/reactor` slash
  command in `slashCommands.ts`.
- (Done: `src/lib/reactive/types.ts`, `POST /api/ai/reactor`.)

### B. REMOVE — research surfaces + dead code (the purge)
- **Routes:** `src/app/(app)/pulse/`, `src/app/(app)/sync/`,
  `src/app/(app)/preview/`.
- **APIs:** `src/app/api/pulse/`, `src/app/api/ai/check-claims/`.
- **Editor research:** `ClaimCheckPanel.tsx`, `ContradictionBanner.tsx`, and
  their wiring in `ForgeEditor.tsx` + the doc page; `useDocContradictions.ts`,
  `useProjectContradictions.ts`.
- **Pulse internals:** `usePulseWorkspace.ts`, `useFreshnessScan.ts`,
  `lib/firestore/pulse.ts`, `forge-graph/adapters/pulse-blocks.ts`.
- **Untangle:** drop Pulse imports from `CalendarProvider`/`SyncProvider`
  (Sync route is being removed; refactor Calendar off Pulse); remove the
  `pulse-blocks` usage in `forge-graph/builder.ts` + `index.ts`.

### C. KEEP (reactive primitives — do NOT remove)
- `forge-graph` core, `/api/forge-graph/embed`, `/api/forge-graph/semantic-check`
  — these stay as the reactive substrate.
- Calendar (untangled from Pulse), Research chat, Projects, Teams, Settings.

## Checkpoints (each green: tsc + lint + build)
- **R2** — Reactor editor node + slash insert + manual Refresh. *(next)*
- **R3** — Drift detection + status + one-tap Reconcile.
- **R4** — Ripples (downstream propagation on save).
- **B-purge** — execute refactor B in green steps; reframe onboarding/landing.
