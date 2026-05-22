# Forge

## The AI Workspace for Everything.

A research, writing, and planning surface that treats facts as living variables — and proves the workspace is internally consistent before you ship.

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Positioning statement](#2-positioning-statement)
3. [The problem](#3-the-problem)
4. [What Forge is](#4-what-forge-is)
5. [Design principles](#5-design-principles)
6. [Product surfaces](#6-product-surfaces)
7. [Unique selling proposition](#7-unique-selling-proposition)
8. [Target users](#8-target-users)
9. [Impact](#9-impact)
10. [Honest competitive comparison](#10-honest-competitive-comparison)
11. [Limitations & open questions](#11-limitations--open-questions)
12. [Business model](#12-business-model)
13. [Three-phase roadmap](#13-three-phase-roadmap)
14. [Risks](#14-risks)
15. [Closing](#15-closing)

---

## 1. Executive summary

Forge is an AI-native workspace built around a single conviction: **facts decay, and software should know it**. Where Notion stores words, Perplexity searches the web, and ChatGPT generates prose, Forge does something none of them attempt — it tracks the commitments inside your documents as logical variables, watches them drift from reality over time, and rewrites the prose that depends on them when they go stale.

The product is built on three engines that share one data model:

- **Sync** — a cross-document constraint compiler. Treats every salary, date, headcount, runway figure, or threshold as a variable. Walks the dependency graph between your documents and finds the paradoxes. Proposes a logical patch that satisfies every declared constraint.
- **Pulse** — a reality-sync layer. Every claim has a half-life. Pulse re-checks each one against current market data, flags drift past your threshold, and pre-writes the rewrite.
- **Tempo** — an AI-native scheduler. Your calendar isn't a list of meetings, it's a planning surface that knows your energy curve, your habits, your goals, and the work Forge itself has scheduled (compile runs, reality-syncs, decay reviews).

Around those engines: a TipTap-based collaborative editor (Lattice) with DOI-verified citations, three reasoning modes (Lightning / Reasoning / Deep), Firebase-backed projects with team collaboration, and a calendar that ingests Google Calendar bidirectionally.

The positioning — _AI Workspace for Everything_ — is deliberate. Forge is not "AI search" (Perplexity), not "AI notes" (Mem), not "AI assistant" (ChatGPT), and not "smart Notion" (Notion AI). It's the surface where research, writing, and planning meet — with a verification layer underneath that none of those tools have attempted.

---

## 2. Positioning statement

> **For** knowledge workers — researchers, founders, analysts, policy people, engineering leads — **who** ship documents whose claims have to stay true over time,
>
> **Forge is** an AI workspace **that** tracks every commitment as a variable, proves the workspace is internally consistent before you ship, and re-checks each claim against today's reality on a cadence you set.
>
> **Unlike** Notion, which is a dumb container, or ChatGPT, which has no project memory, or Perplexity, which verifies queries but doesn't build a persistent investigation,
>
> **Forge** owns the whole loop: research → commit → verify → re-verify → rewrite.

---

## 3. The problem

Knowledge work in 2026 is broken across three planes at once. No single existing tool sits at the intersection.

### 3.1 The hallucination problem

Large language models invent. They fabricate citations, get dates wrong by years, and confidently produce statistics that don't exist in any source they've seen. The fundamental issue is that a token-prediction model has no concept of "true" — only "plausible". Productionizing an LLM for serious work requires a verification layer the model itself cannot provide.

Existing approaches — retrieval-augmented generation, citation enforcement, tool use — help but don't solve the deeper issue: the assistant has no persistent memory of what the user has previously verified, and no awareness of when a previously-true fact has expired.

### 3.2 The dumb-container problem

Notion, Coda, ClickUp, and the rest are excellent at storing structured and unstructured content side-by-side. They are uniformly terrible at understanding the **semantic content** of what they store. A salary number in an offer letter is just a string. A runway figure in a budget doc is just a string. A market size in an investor pitch is just a string. None of these tools detect that those three strings _should be related_, that one feeds another, that changing one should ripple to the others.

The result: a typical 50-document workspace contains 20–40 internal contradictions at any time, almost none of which the user is aware of.

### 3.3 The decay problem

Numbers age. Facts age. A "current as of Q3 2024" line written in October 2024 becomes a quiet lie by February 2025. Most of those lies are never caught because the cost of re-checking every claim manually is prohibitive — and no tool re-checks them automatically.

This is the cost of "moving fast and breaking things" at the document layer: nobody knows which of yesterday's documents are still true.

### 3.4 The planning-vs-doing problem

Calendars schedule meetings. Project trackers schedule deliverables. Notes apps schedule nothing — they just exist. The result is that the work that actually moves a project forward (deep focus on a hard problem, a 90-minute reading session, a reality-sync on the latest market data) never gets time blocked because no surface even knows it's a thing.

### 3.5 The integration tax

The conventional response to all of the above is "stitch together best-of-breed tools": Notion + Perplexity + ChatGPT + Roam + Cal.com + Linear. The integration tax is enormous — context switches, re-entered data, lost provenance, no single source of truth, and every claim duplicated across three tools with no link between them.

---

## 4. What Forge is

Forge is a single workspace built on the conviction that **research, writing, and planning are the same activity at different time horizons**, and that all three should sit on top of the same fact graph.

The product gives the user:

- **Projects** — workspaces that scope a single investigation. Each project owns its claims, sources, citations, documents, calendar events, and AI memory.
- **Lattice** — a TipTap-based collaborative editor with first-class citation primitives, math nodes (KaTeX), and a real-time multi-cursor layer (Yjs + Firestore persistence).
- **Sync** — the cross-document constraint compiler.
- **Pulse** — the reality-decay tracker.
- **Tempo** (inside Calendar) — the AI-native scheduler.
- **Teams** — collaboration with owner / admin / member / viewer roles.

Three reasoning modes set the engine's depth-of-investigation:

| Mode | Depth | Sources | Time |
|---|---|---|---|
| **Lightning** | Snappy answers, abstracts only | 3 | ~5 seconds |
| **Reasoning** | Step-by-step with highlights, DOI-verified | 5 | ~15 seconds |
| **Deep** | Long synthesis, full-text cross-referenced | 10+ | ~60–90 seconds |

Citations are DOI-verified against the source-of-record, not just "linked". The editor renders three citation states inline: verified (green), unverified (orange), failed (red).

---

## 5. Design principles

### 5.1 Facts decay. Docs shouldn't lie.

The Pulse decay model treats every claim as a function of time: each has a half-life appropriate to its kind (a salary figure decays faster than a constant of physics). The product re-checks claims against today's market data on the cadence the user sets (manual / daily / weekly / monthly).

### 5.2 Assistants make mistakes. Compilers find them.

The Sync engine treats the workspace as a logic program. Documents become vertices, commitments become variables, and constraints become edges. A patch is proposed only when the solver can prove it reaches a stable state — and the user can lock any variable they trust, forcing the rest of the graph to rebalance around it.

### 5.3 Time and truth share one surface.

Calendar events and reality-sync runs live on the same canvas. The user sees Tempo's focus blocks and Forge's own compile runs / decay reviews / patch reviews scheduled in the same week. There's one place to look.

### 5.4 Verification is a first-class citizen.

Citations have a verification state, not just a URL. DOIs are checked against the publisher's source-of-record. The editor renders verified / unverified / failed inline. Users see exactly which claims rest on which evidence.

### 5.5 Sharp edges, editorial tone.

Visual: Swiss-brutalist. No rounded corners. Typography-led hierarchy with `font-display` (Urbanist) for headings, `font-sans` (DM Sans) for body. Color palette is restrained — violet primary, cyan / warm / rose / green accents. The product looks like a serious document, not an SaaS dashboard.

---

## 6. Product surfaces

### 6.1 Projects

The workspace primitive. A project owns its documents, sources, claims, calendar events, AI memory, and team membership. Three reasoning modes set the project's default investigation depth.

### 6.2 Lattice (the editor)

A TipTap-based document editor with:

- Real-time multi-cursor collaboration via Yjs, persisted to Firestore.
- Inline citation primitives with verification state.
- Math nodes (KaTeX) for inline and block equations.
- AI commands for drafting, summarising, and extracting claims.

### 6.3 Sync — the cross-document compiler

`/sync` — Section with five sub-routes:

- **Overview** — Featured verdict card ("Workspace is internally consistent" / "N conflicts across your docs"), 4-stat strip (variables / constraints / hard / soft), top-3 conflict preview.
- **Conflicts** — Full list of unresolved violations with filter chips (Hard / Soft) and a dedicated detail page per conflict (`/sync/conflicts/[constraintId]`).
- **Patch** — The proposed logical patch with apply / discard controls; each change has its own detail page (`/sync/patch/[assertionId]`) showing the before → after, solver confidence, full rationale, and the market reference.
- **Documents** — The set of documents the linter watches, plus an assertions explorer per document.
- **History** — Audit trail of applied patches with one-click undo of the most recent.

The solver uses a deterministic constraint propagator (not an LLM). Patches are reproducible, auditable, and reversible.

### 6.4 Pulse — the reality-sync layer

`/pulse` — Section with three sub-routes:

- **Overview** — Featured "last reality-sync" verdict card, top-3 decay list with trust bars, refactor queue CTA.
- **Diffs** — Every claim Pulse re-checked, with filter chips (Invalidated / Stale / Fresh) and dedicated detail pages (`/pulse/diffs/[assertionId]`) showing the workspace value vs reality value, the trust bar, and the blended-oracle contributions when multiple data sources weighed in.
- **Refactors** — The document-rewrite review queue. Compact summary cards (`Safe swap` vs `Needs review`) link to dedicated detail pages (`/pulse/refactors/[blockId]`) with the full RefactorReview component and accept / reject / skip controls plus prev/next navigation.

Decay parameters are configurable per-claim. The default decay model uses kind-aware half-lives (financial metrics decay fast, scientific constants decay slow).

### 6.5 Calendar — Tempo + integrations

`/calendar` — Section with six sub-routes:

- **Calendar** — Month / week / day / agenda / horizon grids with keyboard navigation (arrow keys, Enter, Home/End). All event kinds are colored.
- **Tempo** — AI-native scheduling. Verdict card ("Your week is compiled" / "N conflicts in the way"), priority queue (top 5 items by score), overload heatmap (7-day predicted load), focus blocks Tempo placed for you, conflict + unscheduled summaries.
- **Habits** — 2-column grid of habit cards; each shows the streak count, a 90-day heatmap, the cadence (parsed from an rrule), and a one-click complete button. Streaks survive a single miss; longer breaks trigger a make-up slot.
- **Goals** — First-class scheduling primitives. The most-behind goal is featured with proposed time-pulls visible; others appear in a compact numbered list with progress bars.
- **Integrations** — Google Calendar (live, bidirectional, OAuth, conflict resolver). Outlook / iCloud / Notion Calendar in the roadmap.
- **Compiler events** — Every event Forge itself generates (compile runs, reality-syncs, decay horizons, patch reviews, deadline conflicts), grouped by Today / This week / Later with kind-filter chips and dedicated detail pages.

The Tempo planner is a deterministic packer over an energy-aware routine model. It's not an LLM call — placements are reproducible.

### 6.6 Teams

Four roles: Owner, Admin, Member, Viewer. Standard sharing model. Owner can delete; admins manage members and invites; members edit; viewers read.

### 6.7 Command palette

`Cmd/Ctrl-K` — universal palette indexed against assertions, documents, calendar events, refactor proposals, and lattice tasks. Type-ahead jumps to anything.

---

## 7. Unique selling proposition

**Forge is the only AI workspace that knows when it's lying to itself, and fixes it.**

That sentence does a lot of work. Three components:

1. **Knows** — the Sync compiler detects logical inconsistencies between documents.
2. **Lying to itself** — the Pulse decay layer detects when claims have drifted from current reality.
3. **Fixes it** — the proposed patch (Sync) and pre-written refactor (Pulse) actually rewrite the affected prose, with the user's approval.

No other tool in the category attempts this loop. Notion stores. Perplexity searches. ChatGPT generates. Forge **proves** the workspace consistent.

---

## 8. Target users

The positioning explicitly targets ALL researchers, not just academics. The product fits five overlapping personas:

### 8.1 Founders & operators

Building a company means constantly maintaining a small set of "load-bearing" claims across pitch decks, investor updates, internal docs, and offer letters. (Runway, ARR, headcount, salary bands, hiring plans, market size.) When any of these drift, every dependent document silently lies. Forge catches the drift.

### 8.2 Analysts & researchers (industry)

Equity research, market research, policy research, intelligence work — anyone whose deliverable is a document whose claims need to remain defensible weeks or months after publication. The Pulse decay layer is the differentiated value.

### 8.3 Academics & technical writers

Citation verification, math support, real-time collaboration, structured claims — the editor is built for the long-form, deeply-referenced work that Google Docs handles badly.

### 8.4 Policy and journalism

The verification-first model maps directly to journalism standards: every claim links to a source, the source has a verification state, the verification state is visible to the reader. The editor was designed with this workflow in mind.

### 8.5 Engineering leadership

Architecture decisions, RFC documents, capacity plans, and on-call runbooks all contain claims that decay (load numbers, SLO targets, deprecation timelines, dependency versions). Forge tracks the decay; Sync catches the inconsistencies between the RFC and the runbook.

---

## 9. Impact

The honest answer to "what changes for the user" depends on which surface they spend most time in.

### For a founder
- Pitch decks, investor updates, and offer letters stop quietly contradicting each other.
- Reality-syncs catch out-of-date market data before an investor does.
- Hours of weekly "I think I need to update that number somewhere" anxiety disappear.

### For an analyst
- Reports remain defensible weeks after publication.
- Stale data is flagged proactively, not after a stakeholder asks.
- Citation verification is built into the deliverable.

### For a researcher
- The editor handles long-form, math-heavy, deeply-referenced documents well.
- Real-time collaboration with verification state shared between authors.
- The fact graph is queryable across the whole project.

### For everyone
- One workspace instead of five tools.
- Calendar, research, writing, and decay-tracking on the same surface.
- The product has an opinion. It tells you when something is wrong.

The compounding effect over a year is significant. A team that ships 100 documents per quarter and has 30% of them decay materially over six months would, with Forge, surface that decay in close to real time and avoid the cost of either re-verifying everything by hand or shipping documents that lie.

---

## 10. Honest competitive comparison

This section is deliberately balanced. Each competitor does some things better than Forge today.

### vs Notion / Coda / ClickUp

| Capability | Notion | Forge |
|---|---|---|
| General-purpose blocks | ✅ Excellent | ⚠️ Lattice handles long-form well; less suited for databases, kanbans, calendars-as-content |
| Database views | ✅ Industry-leading | ❌ Not Forge's focus |
| Cross-doc consistency | ❌ None | ✅ Sync compiler |
| Decay tracking | ❌ None | ✅ Pulse |
| AI assistant | ⚠️ Notion AI exists but is generic | ✅ Three reasoning modes, DOI-verified citations |
| Ecosystem & integrations | ✅ Massive | ⚠️ Google Calendar live; Outlook / Notion / iCloud planned |
| Mobile experience | ✅ Polished | ⚠️ Mobile-responsive web; native apps roadmap |

**Honest summary:** Notion is better as a general-purpose content surface. Forge is better when the content has to remain logically consistent and factually current.

### vs ChatGPT / Claude / Gemini

| Capability | ChatGPT | Forge |
|---|---|---|
| Generic Q&A | ✅ Best-in-class | ⚠️ Available via Lattice AI commands but not the product's center |
| Citation enforcement | ⚠️ Improving but unreliable | ✅ DOI-verified, persistent |
| Project memory | ⚠️ Custom GPTs and Projects help | ✅ First-class — every project owns its memory |
| Cross-document reasoning | ❌ None | ✅ Sync compiler |
| Decay tracking | ❌ None | ✅ Pulse |
| Conversational UI | ✅ Native | ⚠️ Forge is document-first, not chat-first |

**Honest summary:** ChatGPT is better for one-off questions and conversational drafting. Forge is better when the output is a document you intend to keep, defend, and re-verify.

### vs Perplexity / You.com

| Capability | Perplexity | Forge |
|---|---|---|
| AI search | ✅ Best-in-class | ⚠️ Three reasoning modes are competitive but not the primary surface |
| Real-time web data | ✅ Fast, broad | ⚠️ Forge's reality-sync covers structured market data; less broad for general queries |
| Citation quality | ✅ Strong inline citations | ✅ DOI-verified, with persistent verification state |
| Building a research project | ⚠️ Threads + Spaces are improving | ✅ First-class projects |
| Writing & editing | ❌ Not the product | ✅ Lattice |
| Calendar / scheduling | ❌ Not the product | ✅ Tempo |

**Honest summary:** Perplexity is better at one-off web research. Forge is better at building a sustained, multi-document investigation that will be edited over time.

### vs Elicit / Consensus

| Capability | Elicit | Forge |
|---|---|---|
| Academic literature search | ✅ Specialised | ⚠️ Forge does this well in Deep mode but isn't specialised |
| Systematic review tooling | ✅ Strong | ❌ Not Forge's current focus |
| Writing & editing | ⚠️ Limited | ✅ Lattice |
| Cross-doc consistency | ❌ None | ✅ Sync |
| Decay tracking | ❌ None | ✅ Pulse |

**Honest summary:** Elicit is better for narrow academic search workflows. Forge is better when the research has to be turned into a written deliverable.

### vs Roam / Obsidian / Logseq

| Capability | Roam / Obsidian | Forge |
|---|---|---|
| Networked thought | ✅ Built around it | ⚠️ Forge has a fact graph but not the same bi-directional-links UX |
| Local-first / privacy | ✅ Obsidian / Logseq | ⚠️ Forge is cloud (Firebase); local mode in roadmap |
| Extensibility / plugins | ✅ Large ecosystem | ❌ No public plugin system yet |
| AI verification | ⚠️ Plugins exist | ✅ Native |
| Cross-doc consistency | ⚠️ Manual | ✅ Sync compiler |

**Honest summary:** Roam/Obsidian are better for personal knowledge management with heavy linking and local-first storage. Forge is better when the work is collaborative and the claims need to be machine-verified.

### vs Linear / Asana / Jira

Forge is not a project tracker. Tempo handles scheduling; it does not handle issue tracking, sprint management, or product roadmapping. Pair Forge with Linear, not replace it.

---

## 11. Limitations & open questions

In the spirit of an unbiased document, the things Forge does NOT do well today:

### 11.1 The fact-extraction problem

Sync and Pulse only work if commitments are extracted from prose into structured assertions. Today this is partly automated (LLM-based extraction with human review) and partly manual. False negatives (missed claims) and false positives (over-eager extraction) both occur. Reducing this friction is an ongoing engineering problem.

### 11.2 The market-data ceiling

Pulse re-checks claims against market oracles. Today the oracle catalogue is narrow — public market data, common compensation ranges, well-known macroeconomic indicators. Long-tail claims (a specific competitor's pricing, a niche regulation) require user-provided oracles or manual review.

### 11.3 Mobile

Mobile-responsive web exists. Native iOS and Android apps do not. Tempo and Pulse notifications work best in a native context.

### 11.4 Offline / local-first

Forge is cloud-first (Firebase). There is no offline mode beyond the browser cache. Users who require local-first storage (regulated industries, certain academic contexts) should evaluate Obsidian.

### 11.5 Ecosystem

Notion has 10+ years and an enormous template/integration ecosystem. Forge is new. Integration breadth (beyond Google Calendar) is a 2026 priority but not a current strength.

### 11.6 Generic database/kanban content

Forge is structured around documents and the fact graph between them. Generic content workflows (project boards, content calendars, CRM lite) are better served by Notion or Airtable.

### 11.7 LLM cost economics

Three reasoning modes consume different amounts of inference. Deep mode is expensive per query. Pricing must reflect this — or Forge subsidises heavy users — which is a real business tension.

### 11.8 Trust in the verification layer

The product asserts that DOI verification is reliable. It is — for journal articles with assigned DOIs. For preprints, blog posts, internal documents, and non-academic sources, the verification model is weaker. The UX must be honest about which "verified" actually means.

---

## 12. Business model

### 12.1 Pricing tiers (proposed)

| Tier | Price (monthly) | Audience | What's included |
|---|---|---|---|
| **Free** | $0 | Individual exploring | 3 projects · Lightning + Reasoning modes · 50 reality-sync runs/month · Google Calendar (1 calendar) · 1 GB storage |
| **Pro** | $20 | Individual power user | Unlimited projects · All three modes · Unlimited reality-sync · All integrations · 50 GB · Priority verification queue · Audit log |
| **Team** | $35 / user | Small teams (≤25) | Everything in Pro · Team workspaces · Roles · Shared fact graph · SSO · 1 TB pooled storage · Admin controls |
| **Enterprise** | Custom | Larger orgs | Everything in Team · Custom oracles · SAML SSO · DPA · On-prem inference option · Dedicated support · Custom retention |

### 12.2 Revenue mechanics

Three reinforcing levers:

1. **Seat licenses** (Team / Enterprise) — the largest revenue line over time.
2. **Inference overage** for heavy Deep-mode users (Pro and above) — keeps the unit economics honest.
3. **Custom-oracle marketplace** (longer-term) — Pulse can re-check against any data source. Third parties (Bloomberg, FRED, internal company databases) become first-class oracles. Revenue share.

### 12.3 Cost structure

The dominant variable cost is LLM inference. Modeling at 2026 prices:

- Lightning ≈ $0.002 per query.
- Reasoning ≈ $0.01–0.03 per query.
- Deep ≈ $0.10–0.40 per query.

Pro at $20/month covers ~50 Deep queries / ~700 Reasoning queries per user. Heavy users go into overage; light users subsidise the system. The economics work as long as the median Pro user runs <30 Deep queries per month.

Fixed costs: Firebase (Firestore, Auth, Storage, Functions), embedding storage, search infrastructure, and the small team building the product. Cloud spend at 1,000 paid users is in the low five figures monthly. Inference dominates above 10,000 users.

### 12.4 Pricing risks

- Underprice and burn capital subsidising Deep mode.
- Overprice and lose to the ChatGPT $20 anchor that competitors have set.
- The metered overage model is hated by power users — UX has to be transparent about cost-per-query in real time.

### 12.5 Go-to-market

Three concurrent motions:

1. **Bottom-up product-led** — free tier with strong virality (shared projects, team invites). Researchers and analysts try alone, bring their teams.
2. **Vertical content** — high-quality long-form on the verification problem in target verticals (equity research, policy, journalism, founder-ops). Establish authority before scaling paid acquisition.
3. **Partnership** — integrate with one or two market-data providers (e.g. FRED, public market APIs) as first-party Pulse oracles. Co-marketing.

Avoid early sales motion. The product earns its way in.

---

## 13. Three-phase roadmap

### Phase 1 — Foundations (live / near-term)
- Lattice editor with citations, math, real-time collaboration.
- Sync compiler with applied-patch undo.
- Pulse with decay tracking and refactor proposals.
- Tempo with focus blocks, overload prediction, and Google Calendar integration.
- Teams with role-based access.

**Status:** Most of this is implemented. The current build is functional end-to-end on the demo data; production-grade reliability work continues.

### Phase 2 — Depth (2026 H1–H2)
- Outlook, iCloud, and Notion Calendar integrations.
- Custom Pulse oracles (user-defined data sources, including private databases).
- Mobile apps (iOS first).
- Improved fact extraction (lower friction, higher precision).
- Enterprise SSO and audit logging.
- Public API for Sync and Pulse — third-party tools can query the fact graph.

### Phase 3 — Platform (2027+)
- Plugin marketplace.
- Oracle marketplace (revenue share with data providers).
- Local-first / on-prem inference option for regulated industries.
- Cross-workspace fact graph (the same claim can live in multiple workspaces with shared verification).
- Specialised verticals (Forge for Policy, Forge for Equity Research) with vertical-specific oracle catalogues.

---

## 14. Risks

### 14.1 Foundation-model commoditisation

If OpenAI / Anthropic / Google add cross-document consistency checking and decay tracking as native features, Forge's moat shrinks. Mitigation: the product is not "an LLM wrapper" — Sync uses a deterministic solver, Tempo uses a deterministic packer, and the editor + collaboration layer is significant engineering. Even if the LLM piece commoditises, the rest doesn't.

### 14.2 Notion AI

Notion has the distribution. If Notion ships a credible cross-doc consistency feature, it could be a real threat. Mitigation: Notion's architecture (blocks-and-databases) is not well-suited to a fact graph. They would have to redesign the underlying data model.

### 14.3 Trust

A verification product whose verification is ever publicly wrong loses credibility quickly. Engineering quality has to be unusually high; UX has to be honest about what "verified" means in each case.

### 14.4 Cost economics

Heavy users of Deep mode could blow the unit economics. Mitigation: transparent overage, soft caps, and inference cost reduction over time (mixture-of-experts, distillation, smaller specialised models for Sync extraction).

### 14.5 Single-founder execution risk

If Forge is single-founder for too long, the surface area is large for one person. Mitigation: hire focused (editor, infra, AI) once initial revenue justifies it.

### 14.6 Market timing

"AI workspace" is a crowded category. If Forge doesn't differentiate sharply through Sync + Pulse, it risks being one of N indistinguishable products. The verification-first positioning is the wedge.

---

## 15. Closing

Forge is built on a wager: that the next decade of knowledge work will reward tools that **know what they don't know**, and rewrite themselves when reality moves under them.

Notion taught the world that documents could be blocks. ChatGPT taught the world that documents could write themselves. Forge is the next step: documents that **prove themselves consistent**, **flag their own decay**, and **rewrite their own stale prose** — with the user always in the loop, always able to lock what they trust, always able to undo what they don't.

The pitch in one line: _the only AI workspace that knows when it's lying to itself, and fixes it_.

The product is built. The hard work now is reach.

---

_Built by Rakshit Khanna. Forge runs on Next.js, Firebase, and verified models._
