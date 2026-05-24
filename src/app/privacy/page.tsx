/**
 * Privacy policy — public, unauthenticated route.
 *
 * Lives outside the (app) and (auth) groups so it renders without any
 * client-side auth context. Content is plain server-rendered prose;
 * keep it that way to avoid the page itself becoming a script-injection
 * vector. The single source of truth for what data is collected and
 * where it lives sits here AND in SECURITY.md — keep both in sync when
 * the data model changes.
 */

import Link from "next/link";

export const metadata = {
  title: "Privacy · Forge",
  description: "What Forge collects, where it lives, and how to remove it.",
};

const LAST_UPDATED = "May 20, 2026";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-2xl px-6 sm:px-10 pt-14 pb-24">
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-4">
          Last updated · {LAST_UPDATED}
        </p>
        <h1 className="font-display font-extrabold text-3xl sm:text-4xl tracking-[-0.025em] leading-[1.05]">
          Privacy.
        </h1>
        <p className="text-[14px] text-muted mt-3 leading-relaxed">
          Plain English. What we collect, where it lives, how long we keep it,
          and how you remove it.
        </p>

        <Section title="What we collect">
          <ul className="space-y-2 text-[14px] leading-relaxed">
            <li><strong>Account data.</strong> Your email and display name from Google sign-in, plus the Firebase Auth uid Google assigns you.</li>
            <li><strong>Workspace content.</strong> The documents, projects, claims, citations, and sources you create. Calendar events, habits, and goals when you use the planning surfaces.</li>
            <li><strong>Integration metadata.</strong> If you connect Google Calendar, the OAuth refresh token and the calendar id you authorised. We never store passwords.</li>
            <li><strong>Operational telemetry.</strong> Error reports via Sentry (no payload bodies), request rate counters for our rate-limiter, and a per-tab session id used only for real-time collaboration cursors.</li>
          </ul>
        </Section>

        <Section title="Where it lives">
          <ul className="space-y-2 text-[14px] leading-relaxed">
            <li><strong>Firebase Auth</strong> — your identity (email, uid, sign-in provider).</li>
            <li><strong>Cloud Firestore</strong> — your projects, documents, claims, citations, calendar entries, habits, goals, audit logs. All paths are user- or team-scoped via Firestore security rules.</li>
            <li><strong>Cloud Storage</strong> — file uploads attached to projects (PDFs, images, exported documents).</li>
            <li><strong>Third-party processors</strong>
              <ul className="mt-1 ml-5 list-disc space-y-1 marker:text-muted">
                <li><span className="font-medium">Anthropic</span> — writing and claim-checking prompts. Anthropic does not train on API traffic.</li>
                <li><span className="font-medium">EXA</span> — research queries sent to the EXA Search API.</li>
                <li><span className="font-medium">Crossref</span> — title/author strings sent for DOI lookup.</li>
                <li><span className="font-medium">Google Calendar</span> — bidirectional sync of events you authorise.</li>
                <li><span className="font-medium">Sentry</span> — error traces (no request bodies, no auth tokens).</li>
              </ul>
            </li>
          </ul>
        </Section>

        <Section title="What we do not collect">
          <ul className="space-y-2 text-[14px] leading-relaxed">
            <li>We do not sell your data to advertisers. Ever.</li>
            <li>We do not train any third-party model on your workspace content.</li>
            <li>We do not log API request or response bodies for AI / research / citation endpoints. Only the error shape and the response status code.</li>
            <li>We do not embed third-party analytics SDKs in the app surfaces.</li>
          </ul>
        </Section>

        <Section title="API keys & secrets">
          <p className="text-[14px] leading-relaxed">
            Every third-party API key (Anthropic, EXA, Crossref, Voyage, the
            Firebase Admin service account) lives server-side only and is
            never shipped to the browser. The Firebase client keys that
            appear in the HTML are public identifiers by design — access
            control is enforced by Firestore security rules, not by hiding
            the project id.
          </p>
        </Section>

        <Section title="How long we keep it">
          <ul className="space-y-2 text-[14px] leading-relaxed">
            <li><strong>Workspace content</strong> — until you delete the project or the account.</li>
            <li><strong>Audit logs (applied patches, refactors)</strong> — bounded buffer per project (last few entries) plus a 90-day retention cap.</li>
            <li><strong>Rejection cooldowns</strong> — 7-day TTL, then swept by Firestore TTL policy.</li>
            <li><strong>Error traces</strong> — 90 days in Sentry, then deleted.</li>
          </ul>
        </Section>

        <Section title="How to remove it">
          <p className="text-[14px] leading-relaxed">
            From <Link href="/settings" prefetch className="text-violet hover:underline">Settings</Link> you can delete a project (all its content), disconnect Google Calendar (revokes our token, deletes synced events from our store), or delete your account (all uid-scoped data wiped within 30 days).
          </p>
        </Section>

        <Section title="Contact">
          <p className="text-[14px] leading-relaxed">
            Privacy or data-deletion requests: <a href="mailto:privacy@forgeresearch.ai" className="text-violet hover:underline">privacy@forgeresearch.ai</a>.
          </p>
        </Section>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10 pt-7 border-t border-border">
      <h2 className="font-display font-bold text-foreground text-[20px] sm:text-[24px] tracking-[-0.018em] leading-[1.2] mb-3">
        {title}
      </h2>
      <div className="text-foreground">{children}</div>
    </section>
  );
}
