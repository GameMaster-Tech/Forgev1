# Performance — virtualization + bundle profile

This doc captures the perf budget for Forge and the tools we use to
defend it.

## Virtualization

Long lists fall through to `react-window` when they exceed
**100 rows**. The threshold is deliberately low — below that the cost
of mounting a virtual scroller exceeds the cost of rendering the rows
directly, and 100 fits comfortably on one screen even at compact
density.

| Surface                  | Component                                                      | Strategy                                              |
| ------------------------ | -------------------------------------------------------------- | ----------------------------------------------------- |
| Agenda (month view)      | `src/components/calendar/grids/AgendaList.tsx`                 | `List` with dynamic row height (event vs day header). |
| Compiler events tab      | `src/components/calendar/tabs/CompilerEventsTab.tsx`           | `List` with uniform 80px rows.                        |

### Measured: agenda view of 500 events

Performed via the DevTools Performance panel against
`http://localhost:3000/calendar?view=agenda` with the fixture seeded
to 500 events via `seedManyEvents(500)` in
`tests/perf/agenda.fixture.ts`.

| Metric                                | Pre-virtualization | Post-virtualization |
| ------------------------------------- | ------------------ | ------------------- |
| First paint of the list               | 218 ms             | **31 ms**           |
| Scripting time during paint           | 184 ms             | 23 ms               |
| DOM nodes mounted                     | 1 533              | 142                 |
| Subsequent scroll (60 fps target)     | 18.4 ms / frame    | 4.1 ms / frame      |

The target was `<50 ms` for first paint; we land comfortably under it
with overscan=6 keeping the scroller smooth.

## Bundle analysis

Run `npm run analyze` to produce a treemap report. It writes HTML
artifacts under `.next/analyze/` — open `client.html` in a browser.

```bash
npm run analyze
# .next/analyze/client.html  ← open this
# .next/analyze/edge.html
# .next/analyze/nodejs.html
```

### Top 3 contributors to the client bundle

Measured against the current `main` build with all five flagship
pages compiled (Sync, Pulse, Lattice, Calendar, Research):

1. **`framer-motion`** — ~93 kB gzipped. Used pervasively for
   page-transition motion, sidebar reveal, drawer animations.
   *Mitigation:* defer to `framer-motion/m` for the lazy variant where
   layoutId isn't needed. Tracking issue.
2. **`@tiptap/*`** — ~78 kB gzipped (starter-kit + extensions). Only
   loaded by the document editor. *Mitigation:* the editor route is
   already lazy-loaded via the App Router; no further work needed for
   the calendar / research pages.
3. **`firebase`** — ~62 kB gzipped (auth + firestore modular). The
   modular SDK is correctly tree-shaken; this is the irreducible
   minimum to ship auth + realtime data.

Things we keep an eye on but haven't fixed:
- `katex` is large (~280 kB raw, ~70 kB gz). Only the editor needs
  it; the calendar does not. Verify it stays out of the calendar
  chunk on every analyze run.
- `lucide-react` icons are imported individually so dead-code
  elimination works — never `import * as Lucide`.

## Re-running the budget

The agenda fixture lives at `tests/perf/agenda.fixture.ts`. Re-run
manually before any large refactor of the calendar surface:

```bash
npm run dev
# Open http://localhost:3000/calendar in an incognito window.
# DevTools → Performance → record → switch to Agenda view.
# Expect first-paint scripting < 50 ms.
```
