/**
 * /share/[token] — public read-only document.
 *
 * Server-rendered so the reader doesn't need a Firebase session. The
 * route resolves the token via the Admin SDK, validates it's not
 * expired or revoked, reads the underlying document, and renders the
 * content with a clean reading frame.
 *
 * Outside the (app) shell — no sidebar, no command palette, no
 * project chrome. Just the document and a tiny "Open Forge" footer
 * that invites the reader to sign up.
 */

import "server-only";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Sparkles, ArrowRight } from "lucide-react";
import { getAdminFirestore } from "@/lib/firebase/admin";

interface PublicLinkDoc {
  documentId: string;
  projectId: string;
  createdBy: string;
  createdAt?: { toMillis?: () => number } | null;
  expiresAt?: number | null;
  revoked?: boolean;
}

interface DocumentDoc {
  title: string;
  content: string;
  userId: string;
  projectId: string;
  updatedAt?: { toMillis?: () => number } | null;
  wordCount?: number;
}

interface ProjectDoc {
  name: string;
}

interface ShareResolution {
  ok: true;
  doc: DocumentDoc;
  projectName: string | null;
  expiresAt: number | null;
}

interface ShareFailure {
  ok: false;
  reason: "not-found" | "expired" | "revoked";
}

async function resolveShare(
  token: string,
): Promise<ShareResolution | ShareFailure> {
  const fs = getAdminFirestore();
  const linkSnap = await fs.doc(`publicLinks/${token}`).get();
  if (!linkSnap.exists) return { ok: false, reason: "not-found" };
  const link = linkSnap.data() as PublicLinkDoc;
  if (link.revoked === true) return { ok: false, reason: "revoked" };
  if (typeof link.expiresAt === "number" && link.expiresAt < Date.now()) {
    return { ok: false, reason: "expired" };
  }

  const docSnap = await fs.doc(`documents/${link.documentId}`).get();
  if (!docSnap.exists) return { ok: false, reason: "not-found" };
  const doc = docSnap.data() as DocumentDoc;

  let projectName: string | null = null;
  try {
    const projSnap = await fs.doc(`projects/${doc.projectId}`).get();
    if (projSnap.exists) projectName = (projSnap.data() as ProjectDoc).name ?? null;
  } catch {
    /* best-effort project name lookup */
  }

  return {
    ok: true,
    doc,
    projectName,
    expiresAt: typeof link.expiresAt === "number" ? link.expiresAt : null,
  };
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await resolveShare(token);

  if (!result.ok) {
    if (result.reason === "not-found") notFound();
    return <ShareUnavailable reason={result.reason} />;
  }

  const updatedAt = result.doc.updatedAt?.toMillis?.() ?? null;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header strip */}
      <header className="border-b border-border px-6 sm:px-10 pt-8 pb-5">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-5 h-5 bg-violet text-white inline-flex items-center justify-center">
              <span className="font-display font-black text-[10px] leading-none">
                F
              </span>
            </span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium">
              Shared from Forge
            </span>
            {result.projectName ? (
              <>
                <span className="text-[10px] text-muted">·</span>
                <span className="text-[10px] uppercase tracking-[0.12em] text-muted truncate">
                  {result.projectName}
                </span>
              </>
            ) : null}
          </div>
          <h1 className="font-display font-extrabold text-3xl sm:text-4xl text-foreground tracking-[-0.025em] leading-[1.05]">
            {result.doc.title || "Untitled document"}
          </h1>
          {updatedAt ? (
            <p className="text-[11px] uppercase tracking-[0.12em] text-muted font-medium mt-3 tabular-nums">
              Last edited {new Date(updatedAt).toLocaleDateString()}
            </p>
          ) : null}
        </div>
      </header>

      {/* Reading surface */}
      <main className="flex-1 px-6 sm:px-10 py-10">
        <div
          className="max-w-3xl mx-auto prose prose-sm sm:prose-base prose-foreground forge-reader"
          // The stored content is sanitised on write via the TipTap
          // schema (no script tags, no inline event handlers). It's
          // still a trusted source — owner-written, not third-party
          // user-generated. Renders as semantic HTML inside the prose
          // container.
          dangerouslySetInnerHTML={{ __html: result.doc.content }}
        />
      </main>

      {/* Footer CTA */}
      <footer className="border-t border-border bg-surface/60">
        <div className="max-w-3xl mx-auto px-6 sm:px-10 py-5 flex items-center gap-4 flex-wrap">
          <Sparkles size={12} strokeWidth={2} className="text-violet" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-semibold">
              Made with Forge
            </p>
            <p className="text-[12px] text-foreground/80 mt-0.5 leading-relaxed">
              The AI research workspace where every fact stays traceable
              to a source.
            </p>
          </div>
          <Link
            href="/auth/signup"
            prefetch={false}
            className="inline-flex items-center gap-1.5 bg-violet text-white text-[11px] uppercase tracking-[0.12em] font-semibold px-4 py-2 hover:bg-violet/90 transition-colors"
          >
            Try Forge
            <ArrowRight size={11} strokeWidth={2} />
          </Link>
        </div>
      </footer>
    </div>
  );
}

function ShareUnavailable({ reason }: { reason: "expired" | "revoked" }) {
  const headline =
    reason === "expired"
      ? "This share link has expired."
      : "This share link was turned off.";
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="max-w-md text-center border border-border bg-surface px-10 py-9">
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-semibold mb-3">
          Forge · share link
        </p>
        <h1 className="font-display font-bold text-foreground text-2xl tracking-[-0.022em] mb-3">
          {headline}
        </h1>
        <p className="text-[13px] text-muted leading-relaxed mb-5">
          Ask whoever shared it to send a fresh link, or open Forge to
          create your own.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 bg-violet text-white text-[11px] uppercase tracking-[0.12em] font-semibold px-4 py-2 hover:bg-violet/90 transition-colors"
        >
          Open Forge
          <ArrowRight size={11} strokeWidth={2} />
        </Link>
      </div>
    </div>
  );
}
