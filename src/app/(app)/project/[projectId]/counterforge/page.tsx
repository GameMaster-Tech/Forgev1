"use client";

/**
 * /project/[projectId]/counterforge — the adversarial-review surface.
 *
 * Counterforge is Forge's skeptic engine. It builds the strongest
 * counter-case it can for every load-bearing claim in your draft,
 * using sources from your own corpus. You either refute, concede, or
 * defer. The readiness score tracks how much of your draft has
 * survived a real counter-argument.
 */

import Link from "next/link";
import { use, useEffect } from "react";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { useProjectsStore } from "@/store/projects";
import { useAuth } from "@/context/AuthContext";
import CounterforgePanel from "@/components/counterforge/CounterforgePanel";

const ease = [0.22, 0.61, 0.36, 1] as const;

export default function CounterforgePage({
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
      <motion.nav
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease }}
        className="sticky top-0 z-20 flex items-center justify-between border-b border-foreground/[0.06] bg-background/85 px-6 py-3.5 backdrop-blur-sm"
      >
        <Link
          href={`/project/${projectId}`}
          className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.15em] text-foreground/55 transition-colors hover:text-rose"
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
        <CounterforgePanel projectId={projectId} />
      </main>
    </div>
  );
}
