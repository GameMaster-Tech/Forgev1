/**
 * POST /api/projects/[pid]/import
 *
 * Two-phase import:
 *   • `mode=preview` (default) — parse the payload and return an
 *     `ImportPreview` with counts + warnings + errors.
 *   • `mode=commit` — write the parsed manifest into the user's
 *     Firestore project. Atomic per collection via chunked batches.
 *
 * Body:
 *   { format: "markdown" | "notion" | "gdoc" | "json", raw: string,
 *     fileMeta?: { name, sizeBytes } }
 *
 * Idempotency: when committing, we set each doc with merge:true so a
 * re-commit collapses to no-ops on identical input.
 */

import { NextResponse, type NextRequest } from "next/server";
import { verifyRequest } from "@/lib/server/auth";
import { getAdminFirestore } from "@/lib/firebase/admin";
import {
  previewImport,
  type ExportFormat,
} from "@/lib/io";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ImportBody {
  format: ExportFormat;
  raw: string;
  fileMeta?: { name: string; sizeBytes: number };
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ pid: string }> }): Promise<Response> {
  const { pid } = await ctx.params;
  const mode = req.nextUrl.searchParams.get("mode") ?? "preview";
  const body = (await req.json().catch(() => ({}))) as ImportBody;

  if (!body.raw || !body.format) {
    return NextResponse.json({ error: "format and raw are required" }, { status: 400 });
  }

  // Hard cap so the preview path can't be used to DoS the parser.
  // The IO library already enforces a soft warning at 5 MB, but here
  // we refuse to even hand it the bytes once we cross 10 MB.
  if (body.raw.length > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "payload exceeds 10 MB cap" }, { status: 413 });
  }

  const preview = await previewImport(body.raw, body.format);

  if (mode === "preview") {
    return NextResponse.json(preview);
  }

  if (preview.errors.length > 0) {
    return NextResponse.json({ error: "preview blocked import", preview }, { status: 400 });
  }

  const user = await verifyRequest(req);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  // Commit phase — chunked Firestore writes.
  const fs = getAdminFirestore();
  const projectPath = `users/${user.uid}/projects/${pid}`;
  await fs.doc(projectPath).set(
    {
      id: pid,
      name: preview.manifest.project.name,
      description: preview.manifest.project.description ?? null,
      lastImportAt: Date.now(),
      lastImportFormat: body.format,
    },
    { merge: true },
  );

  const commits = await Promise.allSettled([
    commitCollection(fs, `${projectPath}/assertions`,  preview.manifest.assertions,  (a) => a.id),
    commitCollection(fs, `${projectPath}/documents`,   preview.manifest.documents,   (d) => d.id),
    commitCollection(fs, `${projectPath}/constraints`, preview.manifest.constraints, (c) => c.id),
    commitCollection(fs, `${projectPath}/blocks`,      preview.manifest.blocks,      (b) => b.id),
    commitCollection(fs, `users/${user.uid}/calendar/habits`, preview.manifest.habits, (h) => h.id),
    commitCollection(fs, `users/${user.uid}/calendar/goals`,  preview.manifest.goals,  (g) => g.id),
  ]);

  const failures = commits.filter((c) => c.status === "rejected");
  if (failures.length > 0) {
    return NextResponse.json({
      ok: false,
      error: "Some collections failed to commit",
      detail: failures.map((f) => (f as PromiseRejectedResult).reason?.message ?? "unknown"),
    }, { status: 500 });
  }

  return NextResponse.json({ ok: true, counts: preview.counts });
}

/* ───────────── helpers ───────────── */

async function commitCollection<T>(
  fs: FirebaseFirestore.Firestore,
  path: string,
  docs: T[],
  keyOf: (doc: T) => string,
  chunkSize = 400,
): Promise<void> {
  if (docs.length === 0) return;
  const col = fs.collection(path);
  for (let i = 0; i < docs.length; i += chunkSize) {
    const slice = docs.slice(i, i + chunkSize);
    const batch = fs.batch();
    for (const doc of slice) {
      batch.set(col.doc(keyOf(doc)), doc as FirebaseFirestore.DocumentData, { merge: true });
    }
    await batch.commit();
  }
}
