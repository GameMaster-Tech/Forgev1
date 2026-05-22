# Security policy

A short, enforceable set of rules every contributor must follow when adding
or modifying code in this repository. These are not aspirations — they are
verified during review and enforced at runtime where possible.

## Rules

### 1. Privacy policy is a first-class artefact

A privacy page lives at `/privacy` (`src/app/privacy/page.tsx`). Any change
to what we collect, where it lives, or how long we keep it MUST update
both `/privacy` and the "Where data lives" section below.

### 2. Where data lives — authoritative map

| Data | Store | Path / table | Retention |
|---|---|---|---|
| Identity (email, uid) | Firebase Auth | managed | account lifetime |
| Projects, documents, claims, citations | Firestore | `users/{uid}/projects/...` | until user-delete |
| Calendar events, habits, goals | Firestore | `users/{uid}/projects/{pid}/calendar/...` | until user-delete |
| File uploads | Cloud Storage | `users/{uid}/projects/{pid}/...` | until user-delete |
| Refactor cooldowns | Firestore | `users/{uid}/projects/{pid}/refactorRejections/{key}` | 7-day TTL |
| OAuth refresh tokens (Google Calendar) | Firestore | `users/{uid}/integrations/google` | until disconnect |
| Audit log (applied patches) | Firestore | `users/{uid}/projects/{pid}/undoLog` | bounded buffer + 90-day cap |
| Error traces | Sentry | external | 90 days |

All Firestore paths are user-scoped. Cross-user reads require a sharing
record + an explicit security-rule allow path; never widen rules to "all
authenticated users".

### 3. Security headers are non-negotiable

`next.config.ts` sets a deny-by-default CSP, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`
locking down camera/microphone/geolocation/payment/USB, COEP/CORP, HSTS
in production, and turns off `X-Powered-By`. Adding a new third-party
endpoint MUST extend `connect-src` (or the matching directive) in
`next.config.ts`, not weaken the policy with `'unsafe-eval'` /
`unsafe-inline`-on-everything / `*`.

### 4. OWASP-basics floor

Every API route in `src/app/api/**/route.ts` must:

1. Authenticate the caller via `verifyRequest` (or `requireUser`) before
   doing any work.
2. Enforce a rate limit via `enforceRateLimit` with the appropriate
   preset (`RATE_LIMIT_EXPENSIVE` for metered upstream calls,
   `RATE_LIMIT_MODERATE` for Firestore writes, `RATE_LIMIT_READ` for
   high-frequency reads/SSE).
3. Validate input with explicit type checks and bounded sizes.
4. Return a fixed projection — never echo upstream responses or raw
   Firestore docs.
5. Scrub errors before returning. Server logs may keep the shape, but
   the response body MUST NOT include stack traces, headers, or
   reflected user input.

Routes that legitimately need to skip a rule MUST document the reason
inline (e.g. `/api/integrations/google/webhook` uses
`verifyGoogleWebhookToken` instead of `verifyRequest`).

### 5. SQL injection · XSS · auth

- **SQL injection:** N/A — we use Firestore (NoSQL). Document queries
  pass values through the SDK; do not concatenate strings into queries.
- **XSS:** Never use `dangerouslySetInnerHTML`. Output goes through React
  which escapes by default. TipTap renders trusted schemas only; any
  HTML-from-AI must be sanitized server-side before being persisted.
- **Auth:** Use `verifyRequest` (ID token / session cookie) for user
  routes, `verifyCronSecret` for cron, `verifyGoogleWebhookToken` for
  Google push notifications. Constant-time comparison is mandatory for
  any HMAC / shared-secret check (the existing helpers already do this).

### 6. .env discipline

- `.env*` files are gitignored. Verify before committing:
  `git status --porcelain | grep -E '^\?\? \.env'` must be empty.
- A variable that the browser needs MUST be prefixed `NEXT_PUBLIC_`.
  A variable without that prefix MUST NOT be referenced from a file
  that ships to the client. The Next.js compiler enforces this; do
  not work around it.
- Anything sensitive (LLM keys, service-account JSON, encryption keys,
  webhook secrets) MUST NOT carry the `NEXT_PUBLIC_` prefix.

Approved `NEXT_PUBLIC_*` variables (Firebase client SDK identifiers,
which are public by design):

```
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID
NEXT_PUBLIC_USE_FIREBASE_EMULATORS         # dev only
NEXT_PUBLIC_AUTH_EMULATOR_HOST             # dev only
NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST        # dev only
NEXT_PUBLIC_SENTRY_DSN                     # public by design
NEXT_PUBLIC_SENTRY_RELEASE
NEXT_PUBLIC_VERCEL_ENV
```

Server-only secrets (must NOT have `NEXT_PUBLIC_`):

```
ANTHROPIC_API_KEY
EXA_API_KEY
VOYAGE_API_KEY
FORGE_NCBI_API_KEY
CROSSREF_API_URL                           # not a secret but server-fetched
FIREBASE_SERVICE_ACCOUNT_JSON
GOOGLE_APPLICATION_CREDENTIALS
GOOGLE_OAUTH_CLIENT_SECRET
CRON_SECRET
SERVER_ENCRYPTION_KEY
SENTRY_AUTH_TOKEN
SENTRY_DSN
```

### 7. API responses never leak sensitive data

- Never include Firebase Auth uids of OTHER users in any response.
- Never echo the full Firestore document — return a projection.
- Never include `error.stack`, request headers, or request bodies in
  the response. They go to the server log only.
- Never include third-party API response objects verbatim. Map them
  through a fixed projection (the four metered routes already do this).

### 8. Secrets must not appear in logs

The codebase enforces this by convention: `console.error` calls in API
routes log a shape like `{ message: err.message }`, never the raw error
object. Avoid `console.log` in production code paths. Sentry sanitisation
should redact `Authorization`, `Cookie`, `x-cron-secret`, and any field
matching `/key|token|secret|password/i`.

### 9. No API keys in the frontend

Every metered upstream is called from a server route under
`src/app/api/**`. The client calls our route; our route calls upstream.
Adding a new upstream SDK MUST:

1. Add a server route under `src/app/api/<name>/route.ts`.
2. Put the key in `.env.local` WITHOUT the `NEXT_PUBLIC_` prefix.
3. Apply `requireUser` + `enforceRateLimit` (see rule 4).

Direct `fetch()` from a `"use client"` file to a third-party API is
forbidden unless the target is a clearly-public read-only endpoint that
doesn't accept secrets (and even then, prefer to proxy through our server).

### 10. Server-side keys / proxy by default

All third-party API access is proxied through our server routes. There
are no direct client-side calls to Anthropic, EXA, Crossref, Voyage,
NCBI, or any other metered upstream. Browser tools should never have
the opportunity to learn one of our keys by sniffing a network request.

### 11. Rate limits are mandatory

`src/lib/server/rate-limit.ts` exports `enforceRateLimit`, presets, and
a `rateLimitResponse` helper. Every API route under
`src/app/api/**/route.ts` MUST call `enforceRateLimit` before doing
anything else (after auth). The presets are deliberately conservative;
override per-route only with a documented justification.

## Incident response

1. Rotate the leaked credential immediately (Firebase console, Anthropic
   dashboard, EXA dashboard, Sentry).
2. Invalidate active Firebase sessions if user data may have been read:
   `auth.revokeRefreshTokens(uid)` per affected uid.
3. Open a private ticket and notify <privacy@forgeresearch.ai>.
4. Update this document with the post-mortem learning.

## Verification

A clean security pass is:

```sh
npx tsc --noEmit                          # types compile
npx next lint                             # no eslint regressions
git diff --stat -- next.config.ts         # security headers present
grep -RIn 'dangerouslySetInnerHTML' src/  # empty
grep -RIn 'NEXT_PUBLIC_' src/ | \
  grep -vE 'firebase|sentry|vercel'       # empty (only approved keys)
```
