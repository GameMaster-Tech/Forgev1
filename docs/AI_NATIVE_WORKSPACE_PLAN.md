# Forge → AI-Native Workspace — Execution Plan (v2)

> Status: **active** · CP1 in progress. Supersedes the research/claims framing.

## 0. North star

Forge is an **AI-native workspace** for any knowledge work — notes, plans,
specs, journals, thinking. Its edge is **not** "more AI features." It is that AI
makes the workspace **fast, comfortable, and high-quality** to think and create
in. Judge every change against three values:

- **Speed** — instant, no spinners where avoidable, streamed, cached, optimistic.
- **Comfort** — zero-friction, reversible, ambient. The user never has to set up
  structure or babysit the AI.
- **Quality** — the AI's output is good enough to keep, in your voice.

**What this is NOT:** not a research tool; not "embed everything into huge
vectors"; not bolted-on chat. Embeddings are used *surgically* (recall, dedup,
grouping) — never as the whole product. The unit we care about is the *content
and the user's intent*, content-agnostic (a meeting note = a spec = a poem).

**Dropped as derivative** (already exist elsewhere — not novel): Weave / Atlas /
related-notes / knowledge-maps / per-claim Grounding. Retired.

## 1. The novel pillars

The novelty is the **interaction model**, not any single widget.

1. **Morph — the malleable document.** Any content (a selection or a whole
   page) can be reshaped by plain language, *in place* and *reversibly*: "turn
   this into a checklist," "make it a table," "tighten this," "rewrite as an
   email to my manager," "extract the decisions." Not a fixed menu of AI buttons
   — an open instruction box that works on any content. Instant preview, one-tap
   apply, one-tap revert. **This is CP1.**

2. **Command-as-Action.** The ⌘K palette stops being just navigation and becomes
   an *action engine*: natural-language operations that execute across the
   workspace ("summarize my last meeting note," "make these three notes a
   project," "draft a reply"). Speed: do it from anywhere, no clicking around.

3. **Continuity.** Forge quietly learns your voice/format/context and applies it
   everywhere (so Morph and Command output land in *your* style), plus instant
   recall of what you already wrote. Comfort + quality, ambient.

## 2. Backend pivot (threads through every CP)

Today the AI/data backend is research-shaped: `/api/ai/write` is a **closed enum**
of 8 writing commands; `/api/ai/check-claims`, `/api/pulse/*`, contradiction and
DOI routes assume claims/citations. The pivot:

- **Generalize the AI action layer.** New `/api/ai/transform` — a content-agnostic
  endpoint that takes a *free-form instruction* + content (+ light context) and
  returns the transformed content. Reframe system prompts away from
  "researchers/Sync/Pulse" to general knowledge work. `/api/ai/write` becomes a
  thin preset wrapper over it (kept for back-compat, then migrated).
- **Speed layer.** Default to a fast Groq model for interactive transforms;
  stream where the UI benefits; cache by (instruction+content) hash.
- **Surgical semantics.** Keep the existing embed endpoint for *recall and
  grouping only*, computed on demand for the active context — not a
  store-everything pipeline.
- **De-emphasize, don't delete.** Pulse/Sync/forge-graph/claims remain reachable
  as optional power-tools; removed from the default new-user path and nav.

## 3. Checkpoints (each ends green: typecheck + lint + `next build`; I report)

- **CP1 — Morph (malleable document).** `POST /api/ai/transform` (general,
  free-form instruction, content-agnostic, fast model, bounded + rate-limited) +
  an inline **Morph** surface in the editor: an instruction box that transforms
  the current selection (or document) with instant preview, Apply, and Revert.
  Reframe the AI system prompt to general workspace. *Verify:* "turn this into a
  table" on a plain paragraph works; applies and reverts cleanly.
- **CP2 — Command-as-Action.** ⌘K runs NL operations on the active doc/workspace,
  routed through the transform/action layer; results land inline or as toasts.
- **CP3 — Continuity + speed pass.** Lightweight style/context memory applied to
  Morph & Command output; streaming + caching for instant feel.
- **CP4 — Workspace re-frame.** Generalize surfaces beyond research (notes/tasks
  unify on the same content model); de-emphasize claim machinery in nav +
  onboarding.

## 4. Risks & decisions

- **Model latency vs quality.** Interactive Morph needs a fast model; long
  transforms can use a deeper one. Start fast (Llama 3.3 70B / 8B-instant),
  expose a "deeper" option later.
- **Reversibility.** Morph applies as a normal editor edit, so Ctrl/Cmd-Z works;
  we also keep the pre-Morph text for an explicit one-tap revert.
- **Don't regress existing AI bar.** `/api/ai/write` stays until CP2 migrates it.
- **Scope discipline.** No store-everything vectors; no new heavy infra in CP1.

## 5. Out of scope (now)

ANN/vector index, multi-modal embeddings, the trained "Veritas-R1/Forge-SAI"
model (does not exist), claim extraction in the core path.
