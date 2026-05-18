# Forge — next 7 big tasks (NEW17 – NEW23)

> Tasks 1–16 landed via routines `claude/keen-carson-nN44A` (1–11) and
> `claude/modest-pasteur-TG2tQ` (12–16). The seven below are the next
> wave. Tasks marked **✅ LANDED** in this turn ship full core + UI;
> tasks marked **🟡 SPEC** are captured here as production-ready
> design docs that a follow-on routine can pick up.

---

## NEW 17 — Real-time collaboration (presence + cursors)  🟡 SPEC

**Goal.** Multi-user simultaneous editing across the TipTap editor, the
Lattice task tree, and the Sync constraint graph. No "last-writer-wins"
overwrites; conflict-free merge.

**Approach.** Don't roll a CRDT from scratch — adopt **Yjs** with
`y-firestore` as the persistence adapter so we stay on the existing
Firestore backend. Yjs gives us per-document CRDT state + an awareness
channel for ephemeral presence (cursors, selections, online state).

**Surface area:**
- `src/lib/collab/index.ts` — Yjs document factory + Firestore provider wrapper
- `src/lib/collab/awareness.ts` — presence shape (uid, displayName, color, cursor)
- `src/components/editor/extensions/Collaboration.ts` — TipTap Yjs binding
- `src/components/editor/extensions/CollaborationCursor.ts` — remote cursors
- `src/components/lattice/PresenceStrip.tsx` — avatar row showing connected users
- `src/components/sync/AssertionLockBadge.tsx` — "X is editing this" badge
- Firestore: `users/{ownerUid}/projects/{pid}/yjs/{docId}` — binary Yjs state vectors

**Exit criteria.** Two tabs editing the same doc see each other's cursors
in <300 ms; concurrent edits to disjoint regions merge automatically.

**Estimated effort.** 2–3 routine fires (Yjs setup, awareness wiring,
TipTap binding, per-feature presence indicators, conflict semantics
for non-text data like assertions).

---

## NEW 18 — AI-powered Lattice parser  🟡 SPEC

**Goal.** Replace the regex-driven `parseIntent` with an Anthropic
Claude Sonnet call that produces structured intent + smarter template
selection. Keep the existing parser as deterministic fallback.

**Approach.** Two-tier: the regex parser runs first (instant), the LLM
runs as a refinement step (~1 s) that the UI awaits and replaces the
intent + drafts when it returns.

**Surface area:**
- `src/lib/lattice/ai-parser.ts` — Anthropic SDK wrapper, zod schema for response
- `src/app/api/lattice/parse/route.ts` — POST { task } → ParsedIntent
- `src/lib/lattice/index.ts` — exposes `parseIntentAsync(raw, opts)` with race-and-replace
- `src/components/lattice/IntentSkeleton.tsx` — loading shimmer while LLM runs
- Anthropic prompt template under `prompts/lattice-parse.md`

**Schema (zod):**
```ts
const ParsedIntentSchema = z.object({
  kind: z.enum(["hire","launch","research","budget","policy","report","deadline","generic"]),
  verb: z.string(), object: z.string(),
  quantity: z.number().optional(),
  byDate: z.string().optional(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),  // shown in the IntentCard
});
```

**Cost guard.** Cache by `intentSignature` — same string → same response.
Hard cap: 50 LLM calls/user/hour.

**Exit criteria.** "Hire a senior backend engineer in Q3 with kafka
experience" produces `intentSignature = hire:senior-backend-engineer-kafka:q3` rather than the current `hire:senior:_`. Falls back to regex if Anthropic 5xx.

---

## NEW 19 — Sharing UI (invite by email, role picker, public link)  ✅ LANDED

**Goal.** Surface the existing `ShareGrant` data model (`src/lib/scheduler/share.ts`) as a real UI flow on every shareable resource (project, calendar, event, task, goal).

**What ships in this turn:**
- `src/lib/sharing/types.ts` — re-exports + extends ShareGrant for cross-domain use
- `src/lib/sharing/store.ts` — local-state grant CRUD + public link mint
- `src/components/sharing/SharingDialog.tsx` — invite-by-email form + role picker + grant table + public-link toggle
- `src/components/sharing/ShareButton.tsx` — small trigger consumed by Sync / Pulse / Lattice / Calendar headers
- `src/app/api/sharing/grants/route.ts` — POST (create), DELETE (revoke)
- `src/app/api/sharing/public-link/route.ts` — POST (mint), DELETE (revoke)

Five roles (owner / editor / commenter / viewer / free-busy) match the existing model. Public links carry expiry; grants carry timestamp + grantor uid.

---

## NEW 20 — Notifications system (in-app bell + preferences)  ✅ LANDED

**Goal.** Per-feature opt-in notifications for Sync conflicts, Pulse invalidations, Lattice rebranches, Tempo overload predictions, habit nudges, sharing changes. Surfaced as an in-app bell with unread count, a notification panel, and a preferences pane.

**What ships in this turn:**
- `src/lib/notifications/types.ts` — Notification + NotificationPreferences shapes
- `src/lib/notifications/store.ts` — in-memory client store with persistence to `users/{uid}/notifications/`
- `src/lib/notifications/dispatcher.ts` — `dispatchNotification(uid, n)` honors preferences
- `src/hooks/useNotifications.ts` — subscribes to the store + SSE realtime events
- `src/components/notifications/NotificationBell.tsx` — header bell with unread badge
- `src/components/notifications/NotificationPanel.tsx` — drop-down list with mark-read + clear
- `src/components/notifications/PreferencesPane.tsx` — opt-in toggles per kind

In-app delivery only this turn. Email digest + browser push captured below in §**Future-work hooks**.

---

## NEW 21 — Version history / time-travel  ✅ LANDED

**Goal.** Every Sync patch applied, every Pulse refactor accepted, every Lattice rebranch, every calendar / task mutation is a `Version` row. UI offers a chronological scrubber that lets the user inspect any prior state and restore.

**What ships in this turn:**
- `src/lib/versions/types.ts` — Version shape (kind, source, before, after, diff summary, timestamp, ownerUid)
- `src/lib/versions/store.ts` — append + query interfaces; in-memory + Firestore impls
- `src/lib/versions/aggregator.ts` — composes the existing Sync undo log, Pulse rejection log, Lattice history, activity feed entries into a unified stream
- `src/app/(app)/history/page.tsx` — chronological version browser with filters
- `src/components/versions/VersionScrubber.tsx` — embeddable on Sync/Pulse/Lattice pages
- Sidebar entry: "History" with `History` lucide icon

Restore is **proposal-mode** only — clicking restore drafts a new Sync patch / Pulse refactor that brings state back, surfacing it through existing flows. No destructive rollback.

---

## NEW 22 — Domain templates / project starters  ✅ LANDED

**Goal.** Five pre-built starter project shapes: Founder, Researcher,
Consultant, Policy analyst, Legal. Each ships with a constraint graph,
seed documents, demo habits, and example goals. First-run wizard offers
to instantiate one.

**What ships in this turn:**
- `src/lib/templates/types.ts` — Template + instantiation contract
- `src/lib/templates/{founder,researcher,consultant,policy,legal}.ts` — five fixtures
- `src/lib/templates/index.ts` — registry + `instantiateTemplate(uid, key)`
- `src/components/onboarding/TemplatePicker.tsx` — first-run wizard (modal)
- Wiring in `src/app/(app)/projects/page.tsx` — empty-state surfaces the picker

The five templates each include: assertions seeded with realistic values, two documents with TipTap-ready content, three habits, two goals, a hiring or research-budget constraint that Sync immediately exercises.

---

## NEW 23 — Export & import (Markdown / Notion / Google Docs)  🟡 SPEC

**Goal.** Round-trip export to and import from Markdown, Notion, and Google Docs. Citations (`[[claim:xyz]]` pills) preserve as footnotes in the target format.

**Surface area:**
- `src/lib/io/markdown.ts` — `serialize(project)` and `parse(md)` with citation round-trip
- `src/lib/io/notion.ts` — Notion blocks API binding via `@notionhq/client`
- `src/lib/io/gdocs.ts` — Google Docs API binding via the existing OAuth token
- `src/app/api/projects/[pid]/export/route.ts` — POST { format } returns a blob
- `src/app/api/projects/[pid]/import/route.ts` — POST { source, payload }
- `src/components/projects/ExportDialog.tsx` — format picker + download / share

**Caveats.** Notion blocks have looser citation semantics — round-trip
will degrade `[[claim:xyz]]` to plain text on the way out, and import
can't reconstitute the binding without a heuristic match step. Document
this explicitly.

---

## Future-work hooks captured but not implemented

- **NEW 20 email digest** — Resend / Postmark via `/api/cron/notify-digest`; daily 8am cron; opt-in per kind.
- **NEW 20 browser push** — Web Push API + service worker; permission flow; subscription store.
- **NEW 18 cost dashboard** — Anthropic token spend per user / per project; rate-limit headers.
- **NEW 21 named branches** — "explore-a-fork" mode that snapshots the project, lets you mutate, then merge or discard. Foundation laid by NEW 21's Version store.
- **NEW 17 conflict resolver UI** — when Yjs detects a structural conflict (e.g. two users delete + edit the same paragraph), surface a manual merge view.
