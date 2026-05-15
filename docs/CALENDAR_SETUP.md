# Calendar — setup guide

This guide turns Tempo's stubbed Google Calendar integration into a working production install.

## Prerequisites

- A Firebase project (Auth + Firestore + Storage) — Forge already requires it.
- Google Cloud project with the **Google Calendar API** enabled. (Assumed per spec.)
- A Vercel / Cloud Run / Fly environment that can run Next.js Route Handlers (server side).

## 1. Google OAuth client

1. Google Cloud Console → APIs & Services → Credentials → **Create Credentials → OAuth 2.0 Client ID**.
2. Application type: **Web application**.
3. Authorized JavaScript origin: `https://<your-prod-host>` (+ `http://localhost:3000` for dev).
4. Authorized redirect URI: `https://<your-prod-host>/api/integrations/google/callback`.
5. Save. Note the **Client ID** and **Client secret**.

OAuth scopes Tempo requests:

```
openid
email
profile
https://www.googleapis.com/auth/calendar.readonly
https://www.googleapis.com/auth/calendar.events
```

The first three give us a display name; `calendar.readonly` covers `listEvents`; `calendar.events` covers create/patch/delete.

## 2. Environment variables

Add to `.env.local` (and your prod env):

```bash
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_OAUTH_REDIRECT_URI=https://<your-prod-host>/api/integrations/google/callback
# Optional: an internal HMAC secret used to sign the OAuth `state` param.
OAUTH_STATE_SECRET=<random 32 byte hex>
```

Never expose `GOOGLE_OAUTH_CLIENT_SECRET` to the client. It only belongs in server routes.

## 3. Route handlers to add

### `app/api/integrations/google/start/route.ts`

Issues the auth URL and a signed `state` token bound to the user's UID.

```ts
// minimal sketch — fill in your auth context
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

export async function GET(req: NextRequest) {
  const uid = req.cookies.get("uid")?.value;
  if (!uid) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const nonce = crypto.randomBytes(16).toString("hex");
  const state = signed(`${uid}.${nonce}`);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id",     process.env.GOOGLE_OAUTH_CLIENT_ID!);
  url.searchParams.set("redirect_uri",  process.env.GOOGLE_OAUTH_REDIRECT_URI!);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type",   "offline");  // get refresh_token
  url.searchParams.set("prompt",        "consent");  // force refresh_token on re-auth
  url.searchParams.set("scope", [
    "openid", "email", "profile",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
  ].join(" "));
  url.searchParams.set("state", state);
  return NextResponse.redirect(url.toString());
}

function signed(payload: string): string {
  const sig = crypto.createHmac("sha256", process.env.OAUTH_STATE_SECRET!).update(payload).digest("hex");
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}
```

### `app/api/integrations/google/callback/route.ts`

Exchanges the auth code for tokens, persists the refresh token, and redirects back.

```ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase/admin"; // your existing helper

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (!code || !state) return NextResponse.json({ error: "missing code/state" }, { status: 400 });
  const uid = verifyAndExtractUid(state);
  if (!uid) return NextResponse.json({ error: "bad state" }, { status: 400 });

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id:     process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      redirect_uri:  process.env.GOOGLE_OAUTH_REDIRECT_URI!,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) return NextResponse.json({ error: "token exchange failed" }, { status: 502 });
  const tokens = await tokenRes.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    id_token: string;
  };

  // Pull email/name from the id_token claim or call userinfo.
  const profile = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  }).then((r) => r.json()) as { email: string; name?: string };

  const fs = getAdminFirestore();
  await fs.collection("users").doc(uid).collection("integrations").doc("google").set({
    status: "connected",
    account: { email: profile.email, displayName: profile.name ?? "" },
    refreshTokenEncrypted: encrypt(tokens.refresh_token ?? ""),
    accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
    scopes: ["calendar.readonly", "calendar.events"],
    connectedAt: Date.now(),
  });

  return NextResponse.redirect(new URL("/calendar?integration=connected", req.url));
}

function verifyAndExtractUid(stateB64: string): string | null { /* HMAC verify, return uid */ return null; }
function encrypt(plain: string): string { /* AES-GCM with a server-side KMS-managed key */ return ""; }
```

### `app/api/integrations/google/sync/route.ts`

Triggers a manual bidirectional sync. Wire to the **Refresh** button in the UI.

```ts
import { listGoogleEvents, bidirectionalDiff, resolveSyncConflict, googleToTimed, timedToGoogle } from "@/lib/scheduler";

// 1. Refresh the access token if expiring within 5 min
// 2. Fetch remote events (paginated)
// 3. Fetch local events from Firestore (`users/{uid}/calendar/events`)
// 4. Load the snapshot (`users/{uid}/integrations/google/snapshot`)
// 5. Compute bidirectionalDiff(...)
// 6. Apply the four write classes (insert/update/delete remote & local)
// 7. Resolve conflicts per the user's chosen policy (default: prefer-newer)
// 8. Persist a fresh snapshot
```

The pure pieces — diff, conflict resolution, mapping — already live in `src/lib/scheduler/gcal.ts`.

## 4. Background sync

Pick one of:

- **Cloud Scheduler + Cloud Run** — recommended for production. A scheduled job hits the sync endpoint every 5 minutes per active user.
- **Vercel Cron** — quick but quotas are tight. Fine for < 1k users.
- **Google push notifications** (`channels.watch`) — best fidelity, push-based, but requires a public HTTPS webhook and channel renewal every 24h.

The exponential backoff in `backoffSchedule()` lives client-side too, so a UI-initiated re-sync after a 429 is automatically polite.

## 5. Firestore mirror

Tempo persists the user-owned writes; remote-side state is mirrored for fast reads:

```
users/{uid}/
  integrations/google              { status, account, refreshTokenEncrypted, ... }
  integrations/google/snapshot/{}  { localId, remoteId, remoteEtag, localFingerprint, syncedAt }
  calendar/events/{eventId}        { ...TimedEvent }
  calendar/tasks/{taskId}          { ...Task }
  calendar/habits/{habitId}        { ...Habit }
  calendar/goals/{goalId}          { ...Goal }
  calendar/routines/active         { ...UserRoutine }
  calendar/shares/{grantId}        { ...ShareGrant }
```

Composite indexes (add to `firestore.indexes.json`):

| Collection                         | Fields                                          |
| ---------------------------------- | ----------------------------------------------- |
| `users/{}/calendar/events`         | `(start, status)`                               |
| `users/{}/calendar/events`         | `(externalId)` for fast remote→local lookup     |
| `users/{}/calendar/tasks`          | `(due, status)`                                 |
| `users/{}/calendar/shares`         | `(resource.kind, resource.id)`                  |

Security rules (sketch — add to `firestore.rules`):

```
match /users/{uid}/calendar/{document=**} {
  allow read, write: if request.auth.uid == uid;
}
match /users/{uid}/integrations/{integration} {
  allow read, write: if request.auth.uid == uid;
}
```

For shared events, the rule additionally checks `users/{ownerUid}/calendar/shares` for an active grant with the requesting user's UID and a sufficient `role`.

## 6. Test the loop locally

```bash
npm run dev
# Visit /calendar → Integrations → Connect.
# In dev mode the existing `mcp__Claude_Preview__preview_*` mock returns a fake account record.
# Once OAuth route handlers exist, the same button hits the real flow.
```

## 7. Revocation handling

If `users/{uid}/integrations/google/refreshTokenEncrypted` rejects with `invalid_grant`, the user revoked Tempo from their Google Account. The state machine transitions to `revoked`; UI surfaces a "Reconnect" CTA, and we **never** silently re-prompt.
