# Backend — refinement & optimization opportunities

> Senior-architect audit of the Forge backend after Tasks 1–16 +
> NEW 19–22 landed. Findings are ordered by impact × ease. Each item
> has a short why + how + estimated effort.

## P0 — Production-blockers (do before any real user)

### 1. Idempotency keys on every POST route
**Why.** Both `/api/integrations/google/sync` and `/api/pulse/refactor/accept` can be triggered twice (user double-clicks, webhook fires twice, cron retry). The sync route is mostly idempotent thanks to the three-way diff, but `accept` writes a body change that re-fires would duplicate-stamp into the activity feed and version log.
**How.** Accept an `Idempotency-Key` header (RFC standard). Server hashes `(uid, route, key)` into a Firestore doc with a 24h TTL. Replay returns the prior response. Add a tiny helper `withIdempotency(req, async () => {...})`.
**Effort.** Half a day.

### 2. Per-user rate limits on AI-bound + sync routes
**Why.** `/api/integrations/google/sync` calls the Google API; `/api/pulse/refactor/accept` mutates Firestore. A malicious or buggy client can hammer either. Today nothing caps QPS.
**How.** Token-bucket per `uid` in Firestore (or Upstash Redis if introduced). Caps: sync 30/min, accept 60/min, watch 5/hour, all mutating writes 120/min global. Return `429` with `Retry-After`.
**Effort.** 1 day. Reuse the existing `verifyRequest` middleware to attach the limiter.

### 3. Refresh-token rotation handling
**Why.** Google occasionally issues a new refresh token on `prompt=consent`. `ensureFreshAccessToken` already detects `invalid_grant`, but doesn't proactively swap in a newly-issued RT during the refresh response.
**How.** In `ensureFreshAccessToken`, if `tokens.refresh_token` is present on the refresh response (rare but happens), re-encrypt and persist. Cover with a unit test.
**Effort.** 1 hour.

### 4. Cron lock to prevent concurrent sweeps
**Why.** Cloud Scheduler can fire `/api/cron/gcal-sync` twice if a previous invocation runs long. Two parallel sweeps over the same user could insert duplicate events.
**How.** Single-instance lock via Firestore: `users/{uid}/integrations/google/_lock` with a 9-min TTL. The cron skips users whose lock isn't expired.
**Effort.** 2 hours.

### 5. Webhook replay protection
**Why.** Google retries push notifications aggressively on 5xx. The webhook is currently idempotent in spirit (it just triggers a sync), but if our handler is slow and Google retries before we ack, we run two concurrent syncs.
**How.** Dedup on `X-Goog-Message-Number` per channel id for a 5-min window. Stored in-memory plus Firestore for cross-instance.
**Effort.** Half a day.

## P1 — Production-grade hardening

### 6. Schema validation on every API request body (zod)
**Why.** `sync/route.ts` parses `body` as `SyncBody` without runtime validation. A malformed `rangeStart` slips through, fails downstream with a cryptic Firestore error. Same for accept/reject routes.
**How.** Define zod schemas adjacent to the route. Apply at the entry. Return `400 { errors }` on parse failure. Existing types stay as the inferred schema output.
**Effort.** 1 day across all routes.

### 7. Access token encryption at rest
**Why.** `accessToken` is short-lived (1h) but stored unencrypted in Firestore. A Firestore-rule misconfig leaks it. Refresh tokens are correctly encrypted; access tokens should match.
**How.** Reuse `encrypt()` from `lib/server/crypto`. Decrypt in-memory on read. Or — simpler — never persist; cache only in `ensureFreshAccessToken`'s in-process Map keyed by uid with TTL = expiresAt.
**Effort.** Half a day.

### 8. Firestore TTL policy for short-lived collections
**Why.** `users/{uid}/realtime/events/` grows unbounded today; the realtime fanout sets `ttlExpiresAt` but Firestore won't auto-delete without a TTL policy.
**How.** `gcloud firestore fields ttls update ttlExpiresAt --collection-group=events`. Same for `users/{uid}/integrations/google/snapshot/` after a sync. Document in CALENDAR_SETUP.md.
**Effort.** 30 minutes + verification.

### 9. Idempotent webhook channel registration
**Why.** `POST /api/integrations/google/watch` always mints a new channel + stops the previous one. If two clients call it concurrently we lose one of the stops and orphan a channel.
**How.** Wrap the stop-then-watch in a Firestore transaction. Lock on `users/{uid}/integrations/google.pushChannel.locked = true`.
**Effort.** 2 hours.

### 10. Structured error logging into Sentry with route + uid breadcrumbs
**Why.** TASK 16 wired `log.event` + `log.error`, but route handlers don't attach uid + route name uniformly. When something fails in prod, the breadcrumb is sparse.
**How.** Wrap every route with `withObservability(req, "route.name", async (req) => ...)`. Pre-set Sentry tags from the verified user.
**Effort.** Half a day.

### 11. Health check + readiness endpoints
**Why.** No way to LB-probe the app today. Cloud Run / Vercel uses HTTP probes.
**How.** `/api/health` returns 200 if Admin SDK initialises + Firestore round-trip <500ms. `/api/ready` checks env vars present + Sentry init + crypto key present.
**Effort.** 1 hour.

## P2 — Scalability & DX

### 12. Caching layer for hot reads
**Why.** Every page mount triggers a Firestore read for `integrations/google`. The doc changes rarely (once per sync). 200ms × 1k DAU adds Firestore cost.
**How.** Stale-while-revalidate cache header on the integration doc. Or migrate to a typed reader that uses `unstable_cache` from `next/cache`.
**Effort.** Half a day.

### 13. Background job durability via a real queue
**Why.** Cron + webhook flows are "best-effort." A 5xx during `runBidirectionalSync` loses the work. There's no retry beyond the cron's next fire.
**How.** Cloud Tasks queue with exponential backoff. The cron enqueues tasks; a separate `/api/queue/process` worker dequeues. Keeps the architecture simple while gaining at-least-once.
**Effort.** 2 days for a clean wire-up.

### 14. Per-collection migration runner
**Why.** Adding a new field to `users/{uid}/calendar/events/{}` requires hand-running a Firestore script. No version tracking.
**How.** `scripts/migrations/<n>-<name>.ts` files that read a `_migrations` collection for "last applied" + run idempotently. Wire to `npm run migrate`.
**Effort.** 1 day.

### 15. Resource-tagged Firestore audit logs
**Why.** When a sync write goes wrong, replay through logs is hard.
**How.** Cloud Logging filters + write a per-day digest doc per uid summarising writes (count, by-collection).
**Effort.** Half a day.

## P3 — Future-of-quality

### 16. Contract tests against Google Calendar API mock
**Why.** The Playwright E2E covers UI flows. The Google API client (`makeServerHttpClient`) is exercised only via mocks. A real Google API contract test (recording from staging once, replaying in CI via `nock`) catches schema drift.
**How.** Record once with `record-replay-server`. Replay in CI. Re-record quarterly.
**Effort.** 1 day setup, ongoing 1 hour/quarter.

### 17. Per-uid Firestore connection pool
**Why.** Admin SDK opens a fresh gRPC stream per request in our current shape. On a hot pod that's wasteful.
**How.** Wrap `getAdminFirestore()` in a long-lived singleton (we already do) and explicitly call `terminate()` only on container shutdown.
**Effort.** Already implemented, but add a smoke test.

### 18. Distributed tracing across SSE + sync
**Why.** When a user does "Accept refactor" → SSE event → calendar refresh, the request trace is fragmented across 4 servers.
**How.** OpenTelemetry instrumentation with trace propagation via the `Traceparent` header through every fetch call we make.
**Effort.** 2 days, biggest payoff in debugging time.

## Cross-cutting recommendation

The single highest-leverage refactor is **introducing zod everywhere**
(P1 item 6). It would unblock idempotency keys (P0 #1), rate limits
(P0 #2), and structured logging (P1 #10) by giving every route a
clean, validated entry point. Schedule that as the next routine's
single focus before any feature work.

## Files touched by this audit

The findings reference the following backend modules:

```
src/lib/firebase/admin.ts
src/lib/server/auth.ts
src/lib/server/crypto.ts
src/lib/server/google-api.ts
src/lib/server/realtime.ts
src/lib/observability/index.ts
src/lib/observability/sentry.ts
src/app/api/integrations/google/{start,callback,sync,disconnect,watch,webhook}/route.ts
src/app/api/cron/{gcal-sync,gcal-renew-watch}/route.ts
src/app/api/pulse/refactor/{accept,reject}/route.ts
src/app/api/calendar/habits/[habitId]/{complete,completions}/route.ts
src/app/api/realtime/calendar/route.ts
```

None of the findings require schema breakage; all are additive.
