# Forge Recall

The memory layer behind Veritas-R1. Built for the way researchers
actually use AI — long, sparse, citation-heavy conversation — without
the over-engineering that makes systems painful to maintain.

This document supersedes the earlier CMOS draft. We pivoted because
CMOS was field-rich and conversation-poor: 12-axis confidence vectors,
5-signal salience sums, contradiction quorums. Great paper, wrong
product. Real users *talk*; they don't fill schemas. Recall is what
remains after we asked "what's the minimum that still beats Claude
where it actually breaks?"

---

## Three primitives. That's it.

| Primitive   | What it is                                              |
| ----------- | ------------------------------------------------------- |
| Snippet     | 1–3 sentences of meaning, with origin + use count       |
| Correction  | A "this superseded that" link between two snippets      |
| Pin         | A boolean on a snippet — user-anchored truth            |

A Snippet looks like:

```ts
interface Snippet {
  id: string;
  projectId: string;
  ownerId: string;
  text: string;                 // verbatim, 1-3 sentences
  origin: "user" | "ai" | "doc" | "web" | "tool";
  sourceRef?: string;           // doc id / URL / messageId
  pinnedByUser: boolean;
  uses: number;
  lastUsedAt: number;
  createdAt: number;
  supersededBy?: string;        // newer snippet that corrects this
  conversationId?: string;
  embedding?: { vector: number[]; dim: number; modelId: string };
}
```

No `confidence.factual`, no `chainOfTrust`, no `salience`. The origin
field carries trust; `uses` carries freshness; `pinnedByUser` carries
user intent. Done.

---

## How it works

### Ingestion (passive)

Every chat turn flows through tiny extractors:

```
user turn   → extractSnippetsFromUserTurn(text)     → createSnippet(origin="user")
              detectCorrectionTrigger(text)          → linkCorrection(...)
ai turn     → extractSnippetsFromAssistantTurn(text) → createSnippet(origin="ai")
doc upload  → extractSnippetsFromDoc(text)           → batch createSnippet(origin="doc")
```

The user never types "remember this." Memory just happens. The only
explicit gesture is the **pin** button — one click anchors a snippet
as load-bearing truth.

### Retrieval (one pass, three feeds)

```
recall(req)
  ├─ recent    — last 8 turns of THIS conversation, raw, deterministic order
  ├─ pinned    — every pinnedByUser snippet in the project, ranked by freshness
  └─ recalled  — BM25 + cosine hybrid over the rest:
                   score = 0.45·bm25 + 0.30·cosine + 0.15·freshness + 0.10·use_boost
```

Plus a transparency pass: every recalled snippet whose `supersededBy`
is set drags in the newer version as a `correction` result. The AI
sees both. It can say "you originally said X, then corrected to Y" —
never echoes a stale belief silently.

### Grounded refusal

Before the response runs, we estimate claim-density of the question
("how many", "compare", "tell me about" all map to different
densities) and check if we have that many `user`/`doc`/`tool` snippets
in the result. If not, the prompt gets a one-line steer:

> GROUNDING SHORTFALL. This question needs 2 grounded source(s); only
> 0 are available in memory. Do not fabricate. Ask the user a
> clarifying question or explicitly flag the uncertainty.

This is the single most effective hallucination defence we have. It's
deterministic, cheap (it's just counting), and works against every
class of LLM "confidently wrong" failure.

---

## How it compares to Claude, ChatGPT, Gemini

### Claude (Projects + new Memory, 2025)

Strengths it brings:
- 200K context window — lets it brute-force whole projects in one prompt
- Files-in-projects RAG
- Soft cross-conversation summarisation

Weaknesses Recall targets:

| Claude weakness                                    | What Recall does instead                              |
| -------------------------------------------------- | ----------------------------------------------------- |
| Summarises older turns → detail lost               | Atomic snippets, verbatim                             |
| Semantic-only retrieval misses exact phrases       | BM25 + cosine hybrid, lexical fires first             |
| Overwrites old beliefs in summary                  | Correction link keeps old visible, marked superseded  |
| "From your files" provenance is vague              | Every snippet has `sourceRef`; emitted as `[s:abc]`   |
| No mid-chat pinning                                | One-click pin                                         |
| Re-emits full content every turn                   | Reference tokens after first emission                 |
| Hallucinates plausibly when underspecified         | Grounded-refusal directive                            |
| Non-deterministic context assembly                 | Same probe + corpus → same recall result              |

### ChatGPT (Memory)

Strengths:
- Conversational naturalness
- "Note" memories for personalisation

Weaknesses Recall targets:

| ChatGPT weakness                                   | What Recall does instead                              |
| -------------------------------------------------- | ----------------------------------------------------- |
| Flat list of LLM-written "memories"                | Typed snippets with origin                            |
| Memories never decay                               | Freshness half-life + use-reinforcement               |
| No conflict tracking — newest just overwrites      | Corrections keep history                              |
| Project context = chat title + memory blob         | Per-project corpus with hybrid retrieval              |
| No source pinning                                  | sourceRef on every snippet                            |

### Gemini (Gems + cross-chat memory + Workspace)

Strengths:
- Live Workspace data pull (Gmail, Drive, Docs)
- Custom Gems for repeated workflows

Weaknesses Recall targets:

| Gemini weakness                                    | What Recall does instead                              |
| -------------------------------------------------- | ----------------------------------------------------- |
| Same "flat note list" memory model                 | Snippets + corrections                                |
| Pulls whole files at runtime, every time           | Pre-extracted snippets, retrieved per query           |
| No belief evolution                                | Correction links                                      |
| Heavy on live data, light on long-term memory      | Long-term memory IS the substrate                     |

---

## What we kept from the heavy CMOS draft

These ideas survived because they directly fix real failures:

1. **Atomic verbatim units, not summaries** — no information loss.
2. **Origin-based trust** — collapsed from a 6-tier enum to a single
   field, but the principle stands: `user-typed` > `doc` > everything
   else. Used only at one decision point (the grounding check).
3. **Correction tracking** — but called "supersedes" and rendered
   inline, not stored as a separate "reasoning delta log."
4. **Pinning + use-based freshness** — but one scalar `uses`, not a
   five-signal salience function.
5. **Determinism** — same query → same recall result. Same engineering
   reason: reproducible answers + provider prefix-cache friendly.
6. **Grounded refusal** — the killer feature. Kept verbatim.
7. **Reference tokens for re-emission** — emit `[s:abc]` instead of
   full text on re-use, falling back to full on cache miss.

## What we dropped

These were the over-engineered bits that didn't pay rent:

- 4-axis `ConfidenceVec` → just `uses` and `origin`
- 9 shard kinds (`fact`/`stance`/`procedural-failure`/...) → one
  `Snippet` kind, content is just text
- 5-weight salience scoring → freshness · uses, two scalars
- Contradiction quorum with union-find → newer wins; old marked
  superseded; both surfaced
- Chain-of-trust hash chain → `origin` enum, single field
- Persona scope per shard → handled by `conversationId`
- Sub-goal nesting / goal stack → the LLM handles this fine when
  pinned snippets carry the goal
- Deterministic CAP with 4-row budget table → simple greedy pack
- HOT/WARM/COLD tier system → Firestore + one BM25 build per call,
  cached by `workspaceCache`

**Net:** ~80% less code, ~5% less capability, vastly easier to
maintain. The capabilities we dropped were academic — they sounded
impressive but didn't show up at the user's seat.

---

## File layout

```
src/lib/recall/
├── types.ts        Snippet, Correction, RecallRequest, RecallResult
├── snippet.ts      CRUD + correction linking + extractors
├── retrieve.ts     recall() — the one entry point
├── refuse.ts       grounded-refusal directive builder
└── index.ts        public re-exports
```

That's the whole module. ~700 lines including comments.

---

## Wiring into chat

Single route handler:

```ts
// src/app/api/chat/route.ts (sketch)
import {
  recall, refusalFor, createSnippet, linkCorrection,
  detectCorrectionTrigger, extractSnippetsFromUserTurn,
  extractSnippetsFromAssistantTurn, recordUse,
} from "@/lib/recall";
import { appendMessage } from "@/lib/firebase/conversations";

// 1. Save the user turn message
await appendMessage(conversationId, { role: "user", content: userText, ... });

// 2. Extract snippets; tag origin=user
const snippetIds: string[] = [];
for (const text of extractSnippetsFromUserTurn(userText)) {
  snippetIds.push(await createSnippet({
    projectId, ownerId: userId, text, origin: "user",
    sourceRef: msgId, conversationId,
  }));
}

// 3. Detect correction; link if matched
const trigger = detectCorrectionTrigger(userText);
if (trigger && snippetIds.length > 0) {
  // pick the most-recent prior snippet from this conversation as the old side
  const prior = await getMostRecentSnippet(conversationId, { excludeIds: snippetIds });
  if (prior) {
    await linkCorrection({
      projectId, oldSnippetId: prior.id, newSnippetId: snippetIds[0], trigger,
    });
  }
}

// 4. Recall context
const ctx = await recall({ projectId, ownerId: userId, probe: userText, conversationId });
const refusal = refusalFor(ctx);

// 5. Build prompt
const prompt = renderPrompt({
  recent: ctx.recent,
  pinned: ctx.pinned,
  recalled: ctx.recalled,
  corrections: ctx.corrections,
  refusalDirective: refusal.instruction,
});

// 6. Call LLM, stream back
const response = await callVeritasR1(prompt);

// 7. Save assistant turn + record uses
await appendMessage(conversationId, { role: "assistant", content: response, ... });
for (const used of citedSnippetIds(response)) await recordUse(used);

// 8. Extract assistant-side snippets so AI assertions enter the corpus
for (const text of extractSnippetsFromAssistantTurn(response)) {
  await createSnippet({ projectId, ownerId: userId, text, origin: "ai", conversationId });
}
```

Total wire-up: ~50 lines. No background workers, no consolidator
cron, no tier promotion logic.

---

## What this gets us (concretely)

- A user can say "actually, I prefer APA for this journal" — that
  correction is visible the next time they ask about formatting; the
  AI says "you switched from MLA to APA on April 12" instead of
  echoing the old default.
- A user can pin "the perovskite paper is arXiv:2401.04088" — that
  binding survives every future "the paper" reference, in every
  future conversation in this project.
- A user can ask "how many cells in the heatmap?" and if the docs
  don't say, the AI asks instead of guessing.
- A year later, a user opens a stale project — pinned snippets and
  recent reuse-extended snippets are still ranked at the top; nothing
  the AI ever cited is silently lost.

Three primitives. One retrieval pass. One refusal gate. Beats Claude
where Claude actually breaks, ties it on naturalness, costs less.
