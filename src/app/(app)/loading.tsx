/**
 * (app)/loading.tsx — instant route-transition skeleton.
 *
 * Shown via Suspense while a new app segment streams in, so navigating
 * between authed routes never flashes a blank main area. Deliberately
 * generic (header strip + a few content rows) so it reads as "Forge is
 * loading" on any destination rather than mimicking one specific page.
 */

export default function AppLoading() {
  return (
    <div className="min-h-full bg-background animate-pulse" aria-hidden>
      {/* Header strip */}
      <div className="border-b border-border px-6 sm:px-10 pt-10 pb-6">
        <div className="h-2 w-24 bg-border/70 mb-4" />
        <div className="h-9 w-64 bg-border/60" />
      </div>

      {/* Content rows */}
      <div className="px-6 sm:px-10 pt-8 space-y-4 max-w-3xl">
        <div className="h-24 bg-surface border border-border" />
        <div className="h-16 bg-surface border border-border" />
        <div className="h-16 bg-surface border border-border" />
        <div className="h-16 bg-surface border border-border" />
      </div>

      <span className="sr-only">Loading…</span>
    </div>
  );
}
