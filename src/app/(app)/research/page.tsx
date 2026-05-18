"use client";

/**
 * Research — the workspace's starting page.
 *
 * Replaces the old /dashboard. Minimal: a tight header strip + the
 * ResearchPanel itself. No metrics, no decorative shapes, no gradient
 * meshes. Same hairline-border + landing-token aesthetic as the
 * marketing pages.
 */

import { motion } from "framer-motion";
import ResearchPanel from "@/components/app/ResearchPanel";

const ease = [0.22, 0.61, 0.36, 1] as const;

export default function ResearchPage() {
  return (
    <div className="min-h-full flex flex-col bg-background">
      {/* Page header — single hairline rule, label + title only */}
      <motion.header
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease }}
        className="border-b border-border px-4 sm:px-10 pt-8 sm:pt-10 pb-6"
      >
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
          Research
        </p>
        <h1 className="font-display font-extrabold text-3xl sm:text-4xl text-foreground tracking-[-0.025em] leading-[1.05]">
          Ask. Verify. Cite.
        </h1>
        <p className="text-[14px] text-muted mt-2 max-w-xl leading-relaxed">
          Search 200M+ sources. Every citation DOI-verified. Save findings into a project when you&apos;re ready.
        </p>
      </motion.header>

      {/* Panel — fills remaining vertical space */}
      <motion.section
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.05, ease }}
        className="flex-1 min-h-0 flex flex-col"
      >
        <ResearchPanel />
      </motion.section>
    </div>
  );
}
