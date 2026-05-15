"use client";

/**
 * /project/[projectId]/planner — the Research Planner surface.
 *
 * Renders the planner panel for the active project. The panel handles
 * its own loading, scanning, accept/dismiss, manual-add, and learning-
 * footer rendering — this page is just the chrome around it.
 */

import Link from "next/link";
import { use, useEffect } from "react";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { useProjectsStore } from "@/store/projects";
import { useAuth } from "@/context/AuthContext";
import ResearchPlannerPanel from "@/components/research-planner/ResearchPlannerPanel";

const ease = [0.22, 0.61, 0.36, 1] as const;

export default function PlannerPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const { user } = useAuth();
  const { projects, fetchProjects } = useProjectsStore();

  useEffect(() => {
    if (user?.uid && projects.length === 0) {
      fetchProjects(user.uid);
    }
  }, [user?.uid, projects.length, fetchProjects]);

  const project = projects.find((p) => p.id === projectId);

  return (
    <div className="relative min-h-screen bg-background">
      {/* Top nav */}
      <motion.nav
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease }}
        className="sticky top-0 z-20 flex items-center justify-between border-b border-foreground/[0.06] bg-background/85 px-6 py-3.5 backdrop-blur-sm"
      >
        <Link
          href={`/project/${projectId}`}
          className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.15em] text-foreground/55 transition-colors hover:text-violet"
        >
          <ArrowLeft size={12} />
          Project
        </Link>
        {project && (
          <span className="truncate text-[12px] text-foreground/55">
            {project.name}
          </span>
        )}
      </motion.nav>

      <main className="mx-auto max-w-6xl px-6 py-10 lg:px-10 lg:py-12">
        <ResearchPlannerPanel projectId={projectId} />
      </main>
    </div>
  );
}
