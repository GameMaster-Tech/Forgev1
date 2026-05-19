/**
 * POST /api/projects/[pid]/export
 *
 * Builds an ExportManifest from the user's project state, runs it
 * through the requested adapter, and returns the payload + correct
 * Content-Type/Content-Disposition so the client can download it.
 *
 * Body:
 *   { format: "markdown" | "notion" | "gdoc" | "json",
 *     include: { syncGraph?, pulseBlocks?, documents?, lattice?, calendar? },
 *     markdown?: MarkdownExportOptions }
 *
 * For unauthenticated previews (no Firestore data), the route accepts a
 * `?demo=1` query param that serialises Forge's demo fixtures so the UI
 * can exercise the flow end-to-end without auth wiring.
 */

import { NextResponse, type NextRequest } from "next/server";
import { verifyRequest } from "@/lib/server/auth";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { buildDemoGraph } from "@/lib/sync";
import { buildDemoBlocks } from "@/lib/pulse";
import { buildDemoSchedule } from "@/lib/scheduler";
import {
  buildManifest,
  getAdapter,
  type ExportFormat,
  type ExportInclude,
  type MarkdownExportOptions,
} from "@/lib/io";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ExportBody {
  format: ExportFormat;
  include?: Partial<ExportInclude>;
  markdown?: MarkdownExportOptions;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ pid: string }> }): Promise<Response> {
  const { pid } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as ExportBody;
  const format = body.format ?? "markdown";
  const adapter = getAdapter(format);
  if (!adapter) return NextResponse.json({ error: `Unknown format: ${format}` }, { status: 400 });

  const isDemo = req.nextUrl.searchParams.get("demo") === "1" || pid === "demo-project";
  const user = isDemo ? null : await verifyRequest(req);
  if (!isDemo && !user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const manifest = isDemo
    ? await buildDemoManifest(pid)
    : await buildFromFirestore(user!.uid, pid, body.include);

  const payload = await adapter.serialise(manifest, body.markdown);
  const filename = `${slug(manifest.project.name)}.${adapter.extension}`;
  return new Response(payload, {
    status: 200,
    headers: {
      "Content-Type": adapter.contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

/* ───────────── data sources ───────────── */

async function buildDemoManifest(pid: string) {
  const graph = buildDemoGraph();
  const blocks = buildDemoBlocks();
  const bundle = buildDemoSchedule();
  return buildManifest({
    projectId: pid,
    projectName: "Forge demo project",
    description: "Series-A founder workspace with Sync, Pulse, and Lattice data seeded for demos.",
    assertions: graph.listAssertions(),
    documents: graph.listDocuments(),
    blocks,
    constraints: graph.listConstraints(),
    habits: bundle.habits,
    goals:  bundle.goals,
  });
}

async function buildFromFirestore(uid: string, pid: string, includeOverride?: Partial<ExportInclude>) {
  const fs = getAdminFirestore();
  // Fan-out reads in parallel.
  const projectPath = `users/${uid}/projects/${pid}`;
  const [projectSnap, assertionsSnap, documentsSnap, constraintsSnap, blocksSnap, habitsSnap, goalsSnap] = await Promise.all([
    fs.doc(projectPath).get(),
    fs.collection(`${projectPath}/assertions`).get(),
    fs.collection(`${projectPath}/documents`).get(),
    fs.collection(`${projectPath}/constraints`).get(),
    fs.collection(`${projectPath}/blocks`).get(),
    fs.collection(`users/${uid}/calendar/habits`).get(),
    fs.collection(`users/${uid}/calendar/goals`).get(),
  ]);

  const project = projectSnap.exists ? projectSnap.data() as { name?: string; description?: string } : undefined;
  return buildManifest({
    projectId: pid,
    projectName: project?.name ?? "Project",
    description: project?.description,
    include: includeOverride,
    assertions:  assertionsSnap.docs.map((d) => d.data() as never),
    documents:   documentsSnap.docs.map((d) => d.data() as never),
    constraints: constraintsSnap.docs.map((d) => d.data() as never),
    blocks:      blocksSnap.docs.map((d) => d.data() as never),
    habits:      habitsSnap.docs.map((d) => d.data() as never),
    goals:       goalsSnap.docs.map((d) => d.data() as never),
  });
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "export";
}
