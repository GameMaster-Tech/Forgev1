import type { Metadata } from "next";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider } from "@/context/AuthContext";

// ── Self-hosted brand fonts ─────────────────────────────────────────
// We ship Urbanist (display) and DM Sans (body) via @fontsource so
// there is zero runtime dependency on Google Fonts. Switched from
// `next/font/google` because corporate TLS interception was causing
// the fetch to fail and silently fall back to system fonts.
//
// `*-variable/index.css` covers the latin + latin-ext subsets across
// the full 100–900 weight axis with a single WOFF2 each.
import "@fontsource-variable/urbanist";
import "@fontsource-variable/dm-sans";

import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Forge — AI Research Workspace",
  description:
    "An AI-powered research workspace. Write, search, organise, and reason — together — across every project.",
  keywords: [
    "research",
    "workspace",
    "AI",
    "knowledge",
    "writing",
    "notes",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      // Set the same CSS variables the rest of the codebase relies on
      // (`var(--font-urbanist)`, `var(--font-dm-sans)` via globals.css
      // `@theme inline`). The fontsource families are `Urbanist Variable`
      // and `DM Sans Variable`; fallbacks preserve metrics on first paint.
      style={
        {
          "--font-urbanist":
            "'Urbanist Variable', Urbanist, ui-sans-serif, system-ui, sans-serif",
          "--font-dm-sans":
            "'DM Sans Variable', 'DM Sans', ui-sans-serif, system-ui, sans-serif",
        } as React.CSSProperties
      }
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ThemeProvider>
          <AuthProvider>
            {children}
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
