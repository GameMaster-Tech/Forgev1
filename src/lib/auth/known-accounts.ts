/**
 * known-accounts — localStorage-backed roster of every Google
 * account that has signed into Forge on THIS device. Powers the
 * Gmail-style account switcher in the sidebar.
 *
 * Why localStorage and not Firestore: each account would need its
 * own Firestore read, and we want the switcher to render
 * instantly without a network round-trip even on a cold start.
 * The list is non-sensitive (email + display name + photo) and
 * scoped to the device.
 *
 * Order is most-recent-first. We cap at MAX_REMEMBERED so a shared
 * device doesn't accumulate a long ghost list.
 */

const STORAGE_KEY = "forge.accounts.known.v1";
const MAX_REMEMBERED = 6;

export interface KnownAccount {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  /** Millis epoch of the most recent active sign-in for this account. */
  lastSignedInAt: number;
}

function safeRead(): KnownAccount[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return (parsed as Partial<KnownAccount>[])
      .filter(
        (a): a is KnownAccount =>
          !!a && typeof a.uid === "string" && typeof a.email === "string",
      )
      .map((a) => ({
        uid: a.uid,
        email: a.email,
        displayName: a.displayName ?? null,
        photoURL: a.photoURL ?? null,
        lastSignedInAt: typeof a.lastSignedInAt === "number" ? a.lastSignedInAt : 0,
      }));
  } catch {
    return [];
  }
}

function safeWrite(rows: KnownAccount[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  } catch {
    /* quota / private mode — drop silently */
  }
}

/**
 * Read the roster. Sorted most-recent-first.
 */
export function listKnownAccounts(): KnownAccount[] {
  return safeRead()
    .slice()
    .sort((a, b) => b.lastSignedInAt - a.lastSignedInAt);
}

/**
 * Remember the current account. Call after every successful sign-in.
 * De-dupes by uid (email can change rarely; uid never does).
 */
export function rememberAccount(account: {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
}): void {
  const existing = safeRead().filter((a) => a.uid !== account.uid);
  const next: KnownAccount[] = [
    {
      uid: account.uid,
      email: account.email,
      displayName: account.displayName,
      photoURL: account.photoURL,
      lastSignedInAt: Date.now(),
    },
    ...existing,
  ].slice(0, MAX_REMEMBERED);
  safeWrite(next);
}

/**
 * Drop a remembered account (e.g. the user clicks "Remove from this
 * device"). Does NOT sign anyone out — that's a separate flow.
 */
export function forgetAccount(uid: string): void {
  safeWrite(safeRead().filter((a) => a.uid !== uid));
}

/**
 * Wipe the roster. Used when the user explicitly "sign out of all"
 * or clears their device.
 */
export function forgetAll(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
