/**
 * Server-side crypto — refresh-token encryption + OAuth state signing.
 *
 * AES-256-GCM for symmetric encryption (refresh tokens at rest).
 * HMAC-SHA256 for state-token signing (OAuth CSRF defense).
 *
 * Key material is provided via env vars:
 *
 *   • SERVER_ENCRYPTION_KEY — 32-byte AES key in base64 (`openssl rand -base64 32`)
 *   • OAUTH_STATE_SECRET    — 32-byte HMAC key (any random hex/base64)
 *
 * Both are required in production. In dev, falls back to derived keys
 * so the local server doesn't crash — but logs a loud warning.
 *
 * Production path: rotate `SERVER_ENCRYPTION_KEY` via the standard
 * AEAD envelope pattern (write `version: "v1"`, decrypt-and-rewrap on
 * read when version mismatches the active key).
 */

import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const ALGO = "aes-256-gcm" as const;
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;

/* ───────────── key derivation ───────────── */

function getEncryptionKey(): Buffer {
  const raw = process.env.SERVER_ENCRYPTION_KEY;
  if (raw) {
    const buf = Buffer.from(raw, "base64");
    if (buf.length === KEY_LEN) return buf;
    // Allow hex too.
    const hex = Buffer.from(raw, "hex");
    if (hex.length === KEY_LEN) return hex;
    throw new Error(`SERVER_ENCRYPTION_KEY must decode to ${KEY_LEN} bytes`);
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("SERVER_ENCRYPTION_KEY is required in production");
  }
  console.warn(
    "[forge.crypto] SERVER_ENCRYPTION_KEY unset — using dev-only derived key. Set the env var before shipping.",
  );
  // Deterministic dev fallback so encrypted blobs round-trip across restarts.
  return scryptSync("forge-dev-fallback", "forge-salt", KEY_LEN);
}

function getStateKey(): Buffer {
  const raw = process.env.OAUTH_STATE_SECRET;
  if (raw) {
    const buf = Buffer.from(raw, "base64");
    if (buf.length >= 16) return buf;
    return Buffer.from(raw, "utf8");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("OAUTH_STATE_SECRET is required in production");
  }
  return scryptSync("forge-state-dev", "forge-state-salt", 32);
}

/* ───────────── AES-GCM ───────────── */

export interface EncryptedBlob {
  /** Versioning for key rotation. `v1` is the only active version today. */
  v: "v1";
  /** Base64 IV. */
  iv: string;
  /** Base64 authentication tag. */
  tag: string;
  /** Base64 ciphertext. */
  ct: string;
}

export function encrypt(plaintext: string): EncryptedBlob {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: "v1",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ct: ct.toString("base64"),
  };
}

export function decrypt(blob: EncryptedBlob): string {
  if (blob.v !== "v1") throw new Error(`Unsupported encryption version: ${blob.v}`);
  const key = getEncryptionKey();
  const iv = Buffer.from(blob.iv, "base64");
  const tag = Buffer.from(blob.tag, "base64");
  const ct = Buffer.from(blob.ct, "base64");
  if (iv.length !== IV_LEN) throw new Error("malformed iv");
  if (tag.length !== TAG_LEN) throw new Error("malformed tag");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

/* ───────────── HMAC state tokens ───────────── */

/**
 * Sign a payload into a URL-safe state token. Used for OAuth `state`
 * to defend against CSRF and to bind the redirect back to the
 * originating user.
 */
export function signState(payload: Record<string, string>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", getStateKey()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyState(token: string): Record<string, string> | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = createHmac("sha256", getStateKey()).update(body).digest("base64url");
  // Constant-time compare to avoid timing oracles.
  const a = Buffer.from(sig, "base64url");
  const b = Buffer.from(expected, "base64url");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/* ───────────── random tokens ───────────── */

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
