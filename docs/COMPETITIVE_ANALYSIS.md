# Competitive analysis — Forge vs Linear vs Notion

_Prepared 2026-05-21. Severity scale below._

**Severity legend**
- **P0 — Table stakes.** Users expect this. Missing it kills onboarding.
- **P1 — Strategic.** Differentiator or major workflow blocker.
- **P2 — Quality of life.** Nice to have. Users will request it.
- **P3 — Niche.** A small subset of users would notice.

---

## Linear — feature inventory

Linear is a software-team issue tracker. Its core moat is *speed* (keyboard-first, instant transitions) and a clean opinionated data model.

### Issue management
- Create, edit, assign, label, prioritize, set due date
- Sub-issues (parent / child hierarchy)
- Issue relations: blocks, blocked by, related, duplicate
- Cycle-based work (2-week sprints with auto rollover)
- Estimates (points or t-shirt sizes)
- Custom views: list, board (kanban), timeline (gantt-lite)
- Bulk edit, multi-select

### Workflow
- Custom statuses per team (backlog → todo → in progress → in review → done → cancelled)
- Custom workflows per project
- Auto-archival of completed issues after a window
- Workflow automations: when status X → do Y

### Projects + Initiatives
- Projects (collection of issues toward a milestone)
- Initiatives (collection of projects toward an outcome)
- Milestones inside projects
- Progress tracking (issues completed / total)
- Project updates (manual status notes with sentiment indicator)
- Roadmap view

### Navigation + speed
- Cmd-K command palette (universal action launcher)
- Keyboard shortcuts for every action
- Instant page navigation (no loading spinners)
- URL-driven views (every state shareable)
- Quick switcher (recent issues / projects)

### Collaboration
- Inline comments + threads on every issue
- @mentions (user, team, issue, project)
- Reactions
- Drafts (unsent comments preserved)
- Activity history per issue
- Inline embeds (Figma, Loom, Linear, etc.)

### Integrations
- GitHub / GitLab / Bitbucket (PR-issue linking, auto-status updates)
- Slack (notifications, slash commands, unfurls)
- Discord
- Figma
- Sentry, PagerDuty, Zendesk, Intercom
- Webhooks + REST + GraphQL APIs + TypeScript SDK
- Linear MCP server

### Search + intel
- Global search (fuzzy)
- Filters by status, assignee, label, priority, project, cycle
- Saved filters / views
- Linear Insights (charts: throughput, cycle time, velocity)
- Ask Linear (LLM-driven search / summary across issues — recent)

### Admin
- Roles (admin, member, guest)
- Teams (sub-orgs with their own projects/cycles)
- SSO (SAML / Google / Apple)
- SCIM provisioning
- Audit logs (enterprise)
- Data export (CSV, JSON, full account export)
- Public API rate limits

### Mobile / desktop apps
- iOS, Android (native)
- macOS, Windows, Linux (Electron)

### Pricing / billing
- Free tier, Standard, Plus, Enterprise
- Per-seat billing
- Annual discount

---

## Notion — feature inventory

Notion is a blocks-based docs + databases workspace. Its core moat is *flexibility* — anything is a block, blocks compose into anything.

### Blocks (the atom)
- Text (headings, paragraph, callout, quote, toggle)
- Lists (bulleted, numbered, to-do)
- Code (syntax highlighted)
- Math (LaTeX)
- Tables (simple)
- Columns (multi-column layouts)
- Dividers, breadcrumbs
- Embeds (200+ — Figma, Loom, YouTube, Twitter, PDFs, Maps, etc.)
- Synced blocks (one block mirrored across many pages)
- Templates (block + page templates)
- AI blocks (generate / summarize / translate / Q&A)

### Pages
- Nested page hierarchy (unlimited depth)
- Cover image + icon per page
- Page properties (title, dates, status, custom)
- Page width controls (default / wide / full)
- Sub-pages, page mentions
- Version history (per-page)
- Comments anchored to selections
- Page locking (prevent edits)
- Page favoriting

### Databases
- Tables, boards (kanban), timelines, calendars, galleries, lists
- 20+ property types: text, number, select, multi-select, date, person, file, checkbox, URL, email, phone, formula, relation, rollup, created/last-edited, created-by/last-edited-by, status
- Filters (any combination, including nested)
- Sorts (multi-column)
- Grouping (group-by any property)
- Linked databases (one source, many views)
- Database templates (auto-populated rows)
- Database automations (when X happens → do Y)
- Sync database (mirror to external Jira, GitHub, etc.)

### AI (Notion AI)
- Generate text from prompt
- Summarize / translate / fix grammar / change tone
- Answer questions about your workspace (RAG)
- Auto-fill database properties from page content
- AI Q&A across all your docs

### Workspace
- Teamspaces (shared collections of pages)
- Workspace-level search
- Workspace-level permissions
- Side peek (open a page beside another)
- Quick find (Cmd+K)
- Slash commands (every block + action)

### Collaboration
- Real-time multi-user editing
- @mentions (people, pages, dates)
- Comments + threads
- Page sharing (workspace / specific people / public link)
- Granular per-page permissions (view / comment / edit / full)
- Guest accounts (paid feature)

### Calendar
- Calendar database view
- Notion Calendar (separate app — bidirectional Google Calendar sync, time-blocking)

### Integrations
- 80+ first-party (Slack, GitHub, Figma, Asana, Trello, Jira, etc.)
- 1000+ via Zapier / Make
- REST API, JS SDK, OAuth public integrations
- Webhooks (recent)
- MCP server (recent)
- Email-in (forward emails to create pages)

### Forms (recent)
- Native Notion Forms (collect submissions into a database)
- Conditional logic, file uploads
- Embeddable on websites

### Search + intel
- Global fuzzy search
- AI-powered search (Notion AI)
- Recent pages, suggested pages

### Admin
- Roles (admin, member, guest)
- SSO (SAML / Google)
- SCIM provisioning
- Audit logs (enterprise)
- Data export (Markdown, HTML, PDF, CSV)
- Trash + restore

### Mobile / desktop
- iOS, Android, macOS, Windows, web
- Offline mode (mobile + desktop)
- Web clipper extension

### Pricing
- Free, Plus, Business, Enterprise
- Per-seat billing

---

## Forge — feature inventory (current state)

Where Forge stands today across the same axes. Items in _italics_ are partially built (demo data or scaffold only).

### Document editor (TipTap-backed)
- Rich text with headings, lists, blockquote, code, link, underline, strikethrough, highlight
- Inline + block LaTeX
- Inline AI commands (continue, expand, simplify, fix-grammar, summarize, etc.)
- Claim mentions — pill-style citations with trust state
- Real-time multi-user editing (Yjs + Firestore provider)
- Word count, presence indicators
- Save to Firestore (`documents` collection)

### Projects + workspaces
- Create / edit / delete projects (Firestore-backed)
- Per-project research mode (Lightning / Reasoning / Deep)
- Per-project system instructions
- Project planner (Research Planner — gap suggestions)
- Project graph view (sources + claims + edges)
- Project export (Markdown / Notion / Google Docs / JSON)
- Project import (round-trip an export)

### Research (chat)
- Single-shot research panel (query → answer + sources)
- 200M+ source integration via EXA
- DOI verification (Crossref)
- Mode-aware retrieval depth

### Sync (cross-document consistency) — renamed "Checks"
- Assertion graph (numbers across docs)
- Constraint detector (sum-equals, less-than, mutex, ratio, etc.)
- Violation listing
- Patch proposer (Sync solver suggests values that satisfy every rule)
- _Project-scoped assertion storage (currently demo bundle in-memory)_

### Pulse (truth-decay tracker) — renamed "Freshness"
- Decay-aware confidence per claim
- Reality-sync diff against oracles
- Refactor proposer (prose rewrites when data drifts)
- Multi-oracle composition
- _Live oracle wiring (market data is mock)_

### Calendar + Tempo
- Month / week / day / agenda / horizon grids
- Personal events (in-memory)
- Google Calendar OAuth + bidirectional sync
- Goals, habits (with streaks + grace tokens)
- Tasks (priority queue, due dates)
- Tempo planner — energy-aware auto-scheduling
- Conflict detection (overload, time-overlap, multi-booking, etc.)
- Habit completion log + streak rendering

### Forge Reactive Workspace (Phases 1–4)
- ForgeGraphNode topology (adapter layer over docs / assertions / events / goals / tasks / blocks)
- Impact Simulator — `/preview` page, sandbox + Delta Map
- Semantic reactivity — debounced editor-level contradiction detection
- AdvancedTempoEngine — cascade propagation, multi-booking resolution, gap compaction
- Workspace invariants — DSL + Firestore-backed CRUD + UI builder at `/calendar/compiler/invariants`
- Tempo execution token (HMAC) + apply route
- TempoEngineCard on `/calendar/tempo`

### Teams + sharing
- Create / edit / delete teams (Firestore)
- Email invites with role
- Team-scoped projects
- Role-based access (owner, admin, member, viewer)
- Pending-invite acceptance flow

### Search + intel
- Workspace search (cached index over docs + claims + queries)
- Recall — snippet-based conversational memory
- Counterforge — _deleted in this round_
- Activity feed (per-user, Firestore-backed)
- Versions / time-travel log

### Auth + admin
- Firebase Auth (email + password, Google sign-in)
- Per-user profile in `/users/{uid}`
- Notification bell (in-app)
- Theme switcher (light / dark)

### Realtime
- SSE channel (`/api/realtime/calendar`)
- Presence (Yjs cursors)

### Integrations
- Google Calendar (OAuth, sync, watch, webhook, disconnect)
- Voyage AI (embeddings, via `/api/forge-graph/embed`)
- Anthropic (writing assist, semantic-check, AI commands)
- EXA (research search)
- Crossref (DOI verification)

### Mobile / desktop
- Responsive web (mobile bottom-nav)
- _No native apps_

### Onboarding
- First-run interactive tutorial (4-step coachmark, dismissable, Firestore-tracked)

### Pricing
- _Not built (no billing layer yet)_

---

## Gap analysis — what Forge is missing

### P0 (Table stakes — fix first)
| Gap | Why P0 | Effort |
|-----|--------|--------|
| **Real per-project data persistence for Sync / Pulse / Calendar events** | All three currently render demo seeders. New users get fake data. | M-L (2-3 weeks) |
| **Sub-pages / nested page hierarchy in documents** | Notion does this; users expect it. Today every doc is flat. | M (1 week) |
| **Comments anchored to text selections** | Standard in every doc tool. Notion + Google Docs + Linear all have it. We don't. | M (1 week) |
| **Native database / table block in the editor** | Notion's killer feature. Forge has citations and prose but no structured tabular block. | L (2-3 weeks) |
| **Search across all pages (global Cmd-K)** | Forge has workspace search but it doesn't surface in a unified palette. Linear's Cmd-K is the gold standard. | S-M (3-5 days) |
| **Public sharing link for a single doc** | Notion + Linear have this. Forge has team sharing but no link-share. | M (1 week) |
| **Version history per document** | Standard expectation. We log versions in `/versions` but no UI to scrub/restore. | M (1 week) |

### P1 (Strategic — defines the product)
| Gap | Why P1 | Effort |
|-----|--------|--------|
| **Multi-turn conversation in /research (real chat history)** | Right now it's a single-shot search. Users expect to follow up, refine, and reference earlier turns. | M (1-2 weeks) |
| **Issue / task tracker for project work** | Forge has goals + habits + scheduled tasks, but no flat issue-board view like Linear. | L (2-3 weeks) |
| **Workflow automations (when X → do Y)** | Notion + Linear both have it. Forge's invariant engine is adjacent but doesn't trigger actions. | M-L |
| **Mobile app (native)** | Linear + Notion both have native apps. Responsive web isn't enough for mobile-first users. | XL (1-2 months per platform) |
| **Public API + SDK for users** | Both competitors expose APIs. Forge has internal API routes but nothing public. | M-L |
| **Webhooks for external systems** | Required for any serious integration play. | M |
| **Slack / Discord notifications** | Bare minimum for team adoption. | M |
| **GitHub / GitLab integration** | If we ever pitch to engineering teams, this is non-negotiable. | M-L |
| **Granular per-page permissions** | Current model is project-level. Notion has per-page. | M |
| **Billing + plans** | Required to charge. Stripe integration + plan gating. | M-L |

### P2 (Quality of life)
| Gap | Why P2 | Effort |
|-----|--------|--------|
| **Drafts (unsent comments / unsaved messages preserved)** | Linear does this; great touch. | S |
| **Saved views / filters** | Activity page filters are session-only. | S-M |
| **Trash + restore** | Currently delete = permanent. Risk-averse users want recovery. | M |
| **Bulk edit (multi-select on lists)** | Standard list manipulation. | S-M |
| **Synced blocks (one block mirrored)** | Notion-style; complex feature. | M |
| **Inline embeds (Figma, Loom, YouTube, etc.)** | TipTap supports embeds via extensions; not wired. | M |
| **Email-in (forward → create doc)** | Notion has it. Helpful for capture. | S-M |
| **SSO (SAML / Google Workspace)** | Required for enterprise. Already have Google sign-in. | M |
| **SCIM provisioning** | Required for enterprise. | L |
| **Audit log for admins** | Enterprise hygiene. | M |
| **Templates (doc, project, calendar)** | Forge has templates folder structure but limited UX. | M |
| **Forms (collect submissions → database)** | Notion has it. Useful for ops teams. | M-L |
| **Reactions on comments** | Tiny feature, huge social value. | S |
| **Offline mode (read + queued writes)** | Notion + Linear both do it. Firestore offline-first helps. | M |
| **Web clipper browser extension** | Notion has it. Capture-into-doc utility. | M |
| **Public roadmap view** | Linear ships theirs in-product. Builds trust. | S |

### P3 (Niche / advanced)
| Gap | Why P3 | Effort |
|-----|--------|--------|
| **Custom workflows per project** | Linear allows custom statuses. Most users use the default. | M |
| **Estimate points / cycles** | Linear-style sprint mechanics. Not a fit if Forge stays research-focused. | M |
| **Notion Calendar app (separate native client)** | Notion paid 2024 to build this. Not table stakes. | XL |
| **Linear Insights (charts, throughput, velocity)** | Analytics dashboards. Power users only. | M-L |
| **Sentry / PagerDuty / Zendesk integrations** | Engineering-team focused. | M each |
| **Multi-language support (i18n)** | Important globally; not table stakes for English-first launch. | L |

---

## Forge's unique advantages (where competitors DON'T have parity)

These are Forge's actual moat — protect and lead with these in marketing.

| Forge has | Linear | Notion | Why this matters |
|-----------|--------|--------|------------------|
| DOI-verified citations inline | ❌ | ❌ | Researchers / academics / journalists won't trust an LLM doc tool without source verification. |
| Cross-document numeric consistency (Sync / Checks) | ❌ | ❌ | Stops budget/headcount/timeline contradictions. No competitor reasons about *numbers* across docs. |
| Truth-decay tracking (Pulse / Freshness) | ❌ | ❌ | "Your runway assumption is 4 months stale" is a unique signal. |
| Impact Simulator (Preview) — sandbox cascades | ❌ | ❌ | Notion has linked databases; nothing computes downstream effects before commit. |
| Semantic-reactivity in the editor | ❌ | Partial (Notion AI is generative, not consistency-aware) | Cross-doc contradiction flashes are unique. |
| Tempo — energy-aware scheduling with goal gravity | ❌ | Partial (Notion Calendar does time-blocking) | The "scheduling around energy + decay urgency" framing is Forge-specific. |
| Operational invariants (rules) on the workspace | ❌ | ❌ | Pre-merge predicates that block bad changes. |
| Lattice / recursive task decomposition (removed; re-evaluate) | ❌ | ❌ | Was unique. May be worth restoring as a power-user feature. |
| Multi-oracle Reality Sync (Pulse) | ❌ | ❌ | Pull live values from market data, internal data lakes, Slack digests. |

---

## Recommended Q3-Q4 priorities

Based on severity + effort, the top six investments:

1. **Replace all demo seeders with Firestore-backed per-project data** (P0, M-L). Without this Sync / Pulse / Calendar are advertising vapor.
2. **Global Cmd-K command palette** (P0, S-M). Cheapest big win.
3. **Comments anchored to selections** (P0, M). Removes a giant "this isn't a real doc tool" objection.
4. **Real multi-turn chat in `/research`** (P1, M). The brand pitch is "chat that knows your project" — deliver that literally.
5. **Public share link per document** (P0, M). Onboarding currency.
6. **Native database / table block** (P0, L). The biggest moat-narrower vs Notion. Without it, knowledge-base buyers default to Notion.

After those, the strategic question is whether to pursue the **engineering-team go-to-market** (issue tracker + GitHub + Slack — competes with Linear) or the **researcher / analyst go-to-market** (extend Sync + Pulse, build the citation moat — competes with Notion AI / academic tools). Pick one. Don't ship halfway into both.

---

_End of analysis._
