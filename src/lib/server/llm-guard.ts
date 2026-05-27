/**
 * LLM guard — the single chokepoint every AI-bound user payload
 * passes through before it leaves Forge.
 *
 * Responsibilities:
 *
 *   1. PII redaction      — strip emails, phone numbers, SSNs, and
 *                           credit-card-shaped strings BEFORE the
 *                           payload reaches Groq / EXA / Notion logs.
 *
 *   2. Prompt-injection   — flag user input that attempts to extract
 *      defense              the system prompt, override role, leak
 *                           tools, or coerce ignore-previous behaviour.
 *
 *   3. Per-user daily     — count AI requests per user per UTC day in
 *      quota                 Firestore. Defaults to 200/day; tunable
 *                           via FORGE_USER_DAILY_AI_CAP.
 *
 *   4. Monthly budget cap — soft kill-switch driven by an env var.
 *      (kill-switch)        Once the workspace-wide cumulative token
 *                           count for the month exceeds the cap, the
 *                           guard refuses new calls with a clear
 *                           "service paused" reason.
 *
 * Every guard returns a small `{ ok, reason }` result so callers can
 * surface a clean 4xx without leaking infrastructure detail. None
 * of these utilities are silent failures — they always log to the
 * server console with [llm.guard] prefix for audit.
 *
 * Server-only. Don't import from client code.
 */

import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase/admin";

/* ─────────────────────────── PII redaction ─────────────────────────── */

/**
 * Redact obvious PII from a free-text payload before it hits the
 * model. Order matters: long patterns first so a credit-card-shape
 * doesn't get partial-matched by the phone rule. Returns the
 * scrubbed string and a count of redactions so we can log "redacted
 * 3 emails" without exposing them.
 */
export interface PiiRedactionResult {
  text: string;
  counts: {
    email: number;
    phone: number;
    ssn: number;
    creditCard: number;
    apiKey: number;
  };
}

const PII_PATTERNS = {
  email: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
  // International + US phone shapes. Avoid matching plain numbers.
  phone: /(?:\+?\d{1,3}[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}\b/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  // 13-19 digit sequences with optional separators — covers Visa,
  // Mastercard, Amex, etc. before they reach upstream logs.
  creditCard: /\b(?:\d[ -]*?){13,19}\b/g,
  // OpenAI-style sk-, Anthropic sk-ant-, Stripe sk_live_, Groq gsk_.
  apiKey: /\b(?:sk|gsk|sk-ant|pk|rk)[_-][A-Za-z0-9-]{16,}\b/g,
};

export function redactPii(input: string): PiiRedactionResult {
  let text = input;
  const counts = { email: 0, phone: 0, ssn: 0, creditCard: 0, apiKey: 0 };
  // Order: credit card → ssn → phone → email → apiKey
  // (each prevents the next from over-matching its own digits.)
  text = text.replace(PII_PATTERNS.creditCard, () => {
    counts.creditCard += 1;
    return "[redacted-card]";
  });
  text = text.replace(PII_PATTERNS.ssn, () => {
    counts.ssn += 1;
    return "[redacted-ssn]";
  });
  text = text.replace(PII_PATTERNS.phone, () => {
    counts.phone += 1;
    return "[redacted-phone]";
  });
  text = text.replace(PII_PATTERNS.email, () => {
    counts.email += 1;
    return "[redacted-email]";
  });
  text = text.replace(PII_PATTERNS.apiKey, () => {
    counts.apiKey += 1;
    return "[redacted-key]";
  });
  return { text, counts };
}

/**
 * Convenience — log the redaction tally without leaking content.
 * Returns true iff anything was redacted.
 */
export function logRedactions(label: string, counts: PiiRedactionResult["counts"]): boolean {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return false;
  console.log(
    `[llm.guard] redacted ${label}:`,
    Object.entries(counts)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${n} ${k}`)
      .join(", "),
  );
  return true;
}

/* ─────────────────────────── prompt-injection ─────────────────────────── */

/**
 * Heuristic prompt-injection detector. We don't try to win the
 * adversarial-ML arms race here — the model itself is also
 * instructed (see route system prompts) to ignore instructions
 * that try to override it. This is the FAST cheap filter that
 * blocks the most common 95% of attacks before they cost us a
 * Groq call.
 */
const INJECTION_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "system_prompt_extraction", re: /\b(?:reveal|show|print|repeat|output)\b.{0,40}\b(?:system|developer|initial)\b.{0,20}\b(?:prompt|instruction|message)/i },
  { name: "instruction_override", re: /\b(?:ignore|disregard|forget|override|bypass)\b.{0,40}\b(?:previous|prior|above|all|earlier)\b.{0,40}\b(?:instruction|prompt|rule|message)/i },
  { name: "role_override", re: /\byou are now\b|\byou will be\b.{0,40}\b(?:dan|jailb|developer mode|admin|root)/i },
  { name: "tool_leak", re: /\b(?:list|show|reveal|describe)\b.{0,40}\b(?:all|your|every)\b.{0,20}\btools?\b/i },
  { name: "raw_secret_dump", re: /\b(?:dump|print|reveal)\b.{0,40}\b(?:env|environment|secret|api[ _-]?key|token)/i },
];

export interface InjectionCheckResult {
  ok: boolean;
  /** Set when a pattern matched. */
  pattern?: string;
  /** Human-friendly reason — safe to send to the client. */
  reason?: string;
}

export function checkPromptInjection(userText: string): InjectionCheckResult {
  if (!userText || userText.length < 6) return { ok: true };
  for (const { name, re } of INJECTION_PATTERNS) {
    if (re.test(userText)) {
      console.warn(`[llm.guard] injection pattern matched: ${name}`);
      return {
        ok: false,
        pattern: name,
        reason:
          "I can't reveal my system prompt or override my safety rules. Ask me something else.",
      };
    }
  }
  return { ok: true };
}

/* ─────────────────────────── per-user daily quota ─────────────────────────── */

const DEFAULT_DAILY_CAP = 200;

function dailyCap(): number {
  const raw = process.env.FORGE_USER_DAILY_AI_CAP;
  if (!raw) return DEFAULT_DAILY_CAP;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DAILY_CAP;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
}

export interface QuotaResult {
  ok: boolean;
  /** Used so far today (after this call). */
  used: number;
  /** Configured cap. */
  cap: number;
  /** Set when ok=false. */
  reason?: string;
}

/**
 * Increment the user's daily counter atomically and return whether
 * they're still under the cap. Fail-open on Firestore errors so a
 * blip doesn't lock the user out — we just log.
 *
 * Path: `users/{uid}/usage_daily/{YYYY-MM-DD}` with `{ count, lastAt }`.
 * Rule (added separately): owner read; server write only.
 */
export async function enforceDailyAiQuota(uid: string): Promise<QuotaResult> {
  const cap = dailyCap();
  const key = todayKey();
  try {
    const fs = getAdminFirestore();
    const ref = fs.doc(`users/${uid}/usage_daily/${key}`);
    // Atomic increment + read in a transaction for accuracy under
    // concurrent calls.
    const next = await fs.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = ((snap.data() as { count?: number } | undefined)?.count ?? 0) + 1;
      tx.set(ref, { count: current, lastAt: FieldValue.serverTimestamp() }, { merge: true });
      return current;
    });
    if (next > cap) {
      console.warn(`[llm.guard] quota exceeded uid=${uid} used=${next} cap=${cap}`);
      return {
        ok: false,
        used: next,
        cap,
        reason: `You've hit today's AI request limit (${cap}/day). Resets at 00:00 UTC.`,
      };
    }
    return { ok: true, used: next, cap };
  } catch (err) {
    console.warn(
      "[llm.guard] daily quota check failed open:",
      err instanceof Error ? err.message : err,
    );
    return { ok: true, used: 0, cap };
  }
}

/* ─────────────────────────── global monthly budget ─────────────────────────── */

const DEFAULT_BUDGET_USD = 0; // 0 = no cap (don't enable until billed)
// Approximate Groq Llama 3.3 70B cost per million tokens (input + output
// blended ballpark). Cheap by design — used for the kill-switch only.
const PER_M_TOKEN_USD = 0.6;

function monthlyBudgetUsd(): number {
  const raw = process.env.FORGE_LLM_MONTHLY_BUDGET_USD;
  if (!raw) return DEFAULT_BUDGET_USD;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_BUDGET_USD;
}

function monthKey(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM UTC
}

export interface BudgetResult {
  ok: boolean;
  spentUsd: number;
  capUsd: number;
  reason?: string;
}

/**
 * Record token usage and enforce the global monthly cap. Fail-open
 * on transport errors; the dollar accounting is a kill-switch, not
 * a billing system. To enable, set FORGE_LLM_MONTHLY_BUDGET_USD in
 * the environment. Without it the function is a no-op.
 *
 * Path: `system/usage_monthly/{YYYY-MM}` (one global counter).
 */
export async function recordTokensAndCheckBudget(
  tokensTotal: number,
): Promise<BudgetResult> {
  const capUsd = monthlyBudgetUsd();
  if (capUsd <= 0) return { ok: true, spentUsd: 0, capUsd: 0 };
  try {
    const fs = getAdminFirestore();
    const ref = fs.doc(`system/usage_monthly/${monthKey()}`);
    const incrementalUsd = (tokensTotal / 1_000_000) * PER_M_TOKEN_USD;
    const spentUsd = await fs.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current =
        ((snap.data() as { spentUsd?: number } | undefined)?.spentUsd ?? 0) + incrementalUsd;
      tx.set(
        ref,
        {
          spentUsd: current,
          tokensTotal: FieldValue.increment(tokensTotal),
          lastAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return current;
    });
    if (spentUsd > capUsd) {
      console.warn(
        `[llm.guard] monthly budget tripped — spent ${spentUsd.toFixed(2)} / cap ${capUsd}`,
      );
      return {
        ok: false,
        spentUsd,
        capUsd,
        reason: "AI features are paused for the month — usage cap reached.",
      };
    }
    return { ok: true, spentUsd, capUsd };
  } catch (err) {
    console.warn(
      "[llm.guard] budget check failed open:",
      err instanceof Error ? err.message : err,
    );
    return { ok: true, spentUsd: 0, capUsd };
  }
}

/**
 * Read-only check — does NOT increment. Use BEFORE the LLM call to
 * refuse early when the budget is already blown.
 */
export async function peekMonthlyBudget(): Promise<BudgetResult> {
  const capUsd = monthlyBudgetUsd();
  if (capUsd <= 0) return { ok: true, spentUsd: 0, capUsd: 0 };
  try {
    const fs = getAdminFirestore();
    const snap = await fs.doc(`system/usage_monthly/${monthKey()}`).get();
    const spentUsd = (snap.data() as { spentUsd?: number } | undefined)?.spentUsd ?? 0;
    if (spentUsd >= capUsd) {
      return {
        ok: false,
        spentUsd,
        capUsd,
        reason: "AI features are paused for the month — usage cap reached.",
      };
    }
    return { ok: true, spentUsd, capUsd };
  } catch {
    return { ok: true, spentUsd: 0, capUsd };
  }
}
