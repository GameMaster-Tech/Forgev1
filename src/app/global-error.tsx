"use client";

/**
 * global-error.tsx — the last line of defence.
 *
 * Catches errors thrown in the root layout / template itself (which the
 * per-segment error.tsx can't reach). It replaces the root layout when
 * active, so it must ship its own <html>/<body> and inline styling — no
 * theme provider, no Tailwind layer guarantees. Kept deliberately minimal
 * and self-contained.
 */

import { useEffect } from "react";

export default function GlobalError({
  error,
  unstable_retry,
  reset,
}: {
  error: Error & { digest?: string };
  unstable_retry?: () => void;
  reset?: () => void;
}) {
  useEffect(() => {
    console.error("Global error:", error);
  }, [error]);

  const retry = unstable_retry ?? reset ?? (() => window.location.reload());

  return (
    <html lang="en">
      <title>Something went wrong — Forge</title>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#E4E0D6",
          color: "#070510",
          fontFamily:
            "'DM Sans Variable', 'DM Sans', ui-sans-serif, system-ui, sans-serif",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <div
            style={{
              display: "inline-flex",
              width: 36,
              height: 36,
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid #1D4ED8",
              color: "#1D4ED8",
              fontWeight: 800,
              fontSize: 15,
              marginBottom: 20,
            }}
          >
            F
          </div>
          <p
            style={{
              fontSize: 10,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: "#4A463F",
              margin: "0 0 12px",
            }}
          >
            Forge
          </p>
          <h1
            style={{
              fontSize: 26,
              lineHeight: 1.1,
              letterSpacing: "-0.022em",
              margin: "0 0 12px",
              fontWeight: 700,
            }}
          >
            Forge hit an unexpected error.
          </h1>
          <p
            style={{
              fontSize: 14,
              lineHeight: 1.6,
              color: "#4A463F",
              margin: "0 0 28px",
            }}
          >
            This one slipped past us. Reloading usually clears it. Your work is
            saved.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              background: "#1D4ED8",
              color: "#fff",
              border: "none",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              padding: "11px 22px",
              cursor: "pointer",
            }}
          >
            Reload Forge
          </button>
        </div>
      </body>
    </html>
  );
}
