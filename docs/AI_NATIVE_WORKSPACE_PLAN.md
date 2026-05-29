# Forge → AI-Native Workspace — Execution Plan (v3)

> Status: **active.** Morph removed. v3 is grounded in a competitive scan
> (May 2026) of Notion AI, Mem, Tana, Reflect, Capacities, Taskade, and the
> wave of "proactive agent" tools.

## 0. What the research actually proves

The AI-workspace category has **converged**. Every serious tool is racing down
the same four lanes:

1. **Agents that do tasks for you** (Notion's agent hub; autonomous multi-step).
2. **Auto-organization** ("don't file anything; AI sorts it" — Mem, Tana).
3. **Q&A / search over your content** (everyone).
4. **Multi-format generation** (one outline → doc/slides/tasks — Skywork, Beautiful.ai).
   …and now **proactive/anticipatory agents** that prep work before you ask.

**Conclusion:** chasing a *never-before-seen feature* is a trap. Everything I
proposed earlier maps onto a lane above — that's *why* Grounding, Weave, Atlas,
and **Morph** all read as derivative. Morph = "delegate a task to the AI," which
is lane 1. Removed.

**Honest reassessment of the other planned pillars:**
- **Command-as-Action** (NL command bar that *does* things) = lane 1 (the agent
  race). Crowded. Dropped as a flagship.
- **Continuity** (style/persistent memory) = Mem's whole pitch. Not unique on
  its own. Demoted to an enhancer.

## 1. The lane no one owns

Every competitor frames AI as a **producer/doer** that takes work *off* you, and
is sprinting toward *more autonomy*. The unoccupied, contrarian position:

> **Forge keeps you in flow. AI amplifies the human in the act of thinking and
> writing — instantly, reversibly — and never takes over.**

This is the *opposite* of the agent race, and it is exactly where **speed,
comfort, quality** live:

- **Speed** — no chat round-trips, no "go ask the AI." Help appears *in* the
  work, at the keystroke, sub-second.
- **Comfort** — you never leave the keyboard, never lose control, everything is
  reversible/ignorable. The AI is ambient, not a thing you operate.
- **Quality** — output is in *your* voice and *your* context, so it's keepable.

**Intellectual honesty:** no single mechanic below is unprecedented in isolation
(in-line suggestions, recall, etc. all exist somewhere). The moat is the
**consistent stance executed better than anyone**: every AI touch in Forge is
in-flow, instant, reversible, and human-led — never a chat box, never a delegate,
never a wait. That consistency is the product.

## 2. Signature build — "Flow"

A small set of in-flow amplifiers that share one rule: *zero prompts, instant,
reversible, in your voice.*

- **F1 — In-flow continuation.** As you pause, Forge offers the next phrase / the
  next bullet as dim **ghost text**; **Tab** accepts, anything else dismisses.
  Grounded in the current document (and your recent voice), not a generic model.
  No menu, no chat, no spinner.
- **F2 — In-flow polish.** Select a few words → an instant, inline single-tap
  tighten/clarify that *shows the change* and is one keystroke to accept/undo
  (reversible diff, not a destructive replace).
- **F3 — In-flow recall (later).** When a sentence you're typing closely matches
  something you already wrote, a one-line, dismissible cue lets you pull it in —
  surfaced *inline while typing*, never a panel.

Differentiation vs. autocomplete/Notion: **zero-prompt + your-context grounding +
reversible + thought/structure-level (not just word-level) + the no-chat stance.**

## 3. Backend posture

- **Speed first.** A dedicated, low-latency completion path on `FAST_MODEL`,
  streamed, short-output, aggressively debounced + cached. Interactive AI must
  feel instant — that is the feature.
- **Reuse, don't sprawl.** Build on the existing Groq layer and auth/rate-limit
  helpers. Surgical embeddings only where recall (F3) needs them.
- **De-emphasize** research/claims surfaces from the default path (unchanged from
  v2): keep as optional tools, not the identity.

## 4. Checkpoints (each ends green: typecheck + lint + `next build`; I report)

- **CP-A — F1 in-flow continuation.** Fast streamed completion endpoint + a
  ProseMirror ghost-text layer (Tab accept / Esc dismiss), debounced, off by
  default with a one-tap toggle. *Verify:* pause → ghost appears <1s, Tab keeps
  it, typing dismisses it, fully reversible.
- **CP-B — F2 in-flow polish** (reversible inline diff on a selection).
- **CP-C — speed/quality pass** (caching, voice grounding) + **F3 recall**.
- **CP-D — de-emphasize research framing in nav/onboarding.**

## 5. Risks & decisions

- **"This is just autocomplete."** Mitigated by grounding + reversibility + the
  consistent no-chat stance; F2/F3 move it past word-level completion. If the
  bar is "unprecedented mechanic," that likely doesn't exist in this category —
  see §0.
- **Latency.** Sub-second is the whole point; if `FAST_MODEL` can't hit it
  reliably, the feature fails its own test — we measure before shipping CP-A.
- **Distraction.** Ghosting must be calm and opt-in; never auto-insert.

## 6. Out of scope (now)

Autonomous agents, store-everything vectors, multi-modal, the unbuilt
"Veritas-R1/Forge-SAI" model, claim extraction in the core path.
