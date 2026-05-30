import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

/* ──────────────────────────────────────────────────────────────────────
 * Security headers — applied to every response by Next.js.
 *
 * Defence-in-depth even though the app itself sanitises output. None of
 * these replace correct Firestore rules or the per-route auth helper; they
 * close the gaps that come from someone embedding the app, MITM-ing the
 * cleartext channel, or sniffing the referer.
 *
 * Notes:
 * - HSTS is only sent in production. In dev we hit http://localhost so
 *   forcing https here would brick the loopback.
 * - The CSP allow-lists are deliberately tight. If a new third-party
 *   endpoint is added (e.g. Stripe), extend `connect-src` here, not via
 *   `unsafe-inline` or `unsafe-eval`.
 * - `unsafe-inline` is required by Tailwind utility styles + Next.js
 *   bootstrap. `'unsafe-eval'` is dev-only to keep React Refresh working.
 * - We never set `Access-Control-Allow-Origin: *` globally — CORS for any
 *   cross-origin API endpoint must be set explicitly in that route.
 * ────────────────────────────────────────────────────────────────────── */

const isProd = process.env.NODE_ENV === "production";

const CSP_DIRECTIVES: Record<string, string[]> = {
  "default-src": ["'self'"],
  // Next bootstrap + React inline runtime need 'unsafe-inline'. Dev also
  // needs 'unsafe-eval' for React Refresh.
  "script-src": isProd
    ? ["'self'", "'unsafe-inline'", "https://apis.google.com", "https://www.gstatic.com"]
    : ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://apis.google.com", "https://www.gstatic.com"],
  // Tailwind injects inline <style> blocks at build/dev time.
  "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
  "img-src": ["'self'", "data:", "blob:", "https:"],
  "media-src": ["'self'", "blob:"],
  // Outbound calls — Firebase, Sentry, Google APIs (Calendar/OAuth),
  // and the apex domain for SSE. Anything else must be added explicitly.
  "connect-src": [
    "'self'",
    "https://*.googleapis.com",
    "https://*.firebaseio.com",
    "https://*.firebase.googleapis.com",
    "https://identitytoolkit.googleapis.com",
    "https://securetoken.googleapis.com",
    "https://firestore.googleapis.com",
    "https://*.cloudfunctions.net",
    "https://accounts.google.com",
    "https://*.sentry.io",
    "https://api.crossref.org",
    // Vercel preview / local dev — emulator hosts. Harmless in prod.
    "ws:",
    "wss:",
  ],
  "frame-src": [
    "'self'",
    // Firebase Auth popup flows.
    "https://*.firebaseapp.com",
    "https://accounts.google.com",
  ],
  "worker-src": ["'self'", "blob:"],
  // Hardening defaults — locked unless explicitly relaxed.
  "frame-ancestors": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "object-src": ["'none'"],
  "upgrade-insecure-requests": [],
};

function buildCSP(): string {
  return Object.entries(CSP_DIRECTIVES)
    .map(([k, v]) => (v.length === 0 ? k : `${k} ${v.join(" ")}`))
    .join("; ");
}

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: buildCSP() },
  // Click-jacking — also enforced by CSP frame-ancestors but kept for
  // older browsers that don't support frame-ancestors.
  { key: "X-Frame-Options", value: "DENY" },
  // Mime-sniffing — pin Content-Type so browsers never guess.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Don't leak full URLs (paths can carry doc/project ids) on cross-origin
  // navigation. Same-origin still gets the full referrer for analytics.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Disable powerful features the app never uses. Anyone hot-loading code
  // that tries to ask for them gets a console error rather than silent
  // success. EXCEPTION: microphone=(self) — Aria, the voice agent, needs the
  // mic on our own origin (Web Speech API / getUserMedia). Without (self) the
  // policy hard-blocks the mic regardless of the browser's site permission.
  {
    key: "Permissions-Policy",
    value: [
      "camera=()",
      "microphone=(self)",
      "geolocation=()",
      "payment=()",
      "usb=()",
      "interest-cohort=()",
    ].join(", "),
  },
  // Cross-origin isolation hardening — don't allow embedding our docs in
  // hostile contexts.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Cross-Origin-Resource-Policy", value: "same-site" },
  // DNS prefetch control — let the browser decide; we don't ship cross-
  // domain assets we want pre-resolved.
  { key: "X-DNS-Prefetch-Control", value: "off" },
  ...(isProd
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

const nextConfig: NextConfig = {
  // Hide framework fingerprint — small but free hardening.
  poweredByHeader: false,
  // Always serve security headers on every path. Static assets get them
  // too, which is harmless and means a malicious script injected into
  // `/_next/static/*` would still be CSP-restricted.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);
