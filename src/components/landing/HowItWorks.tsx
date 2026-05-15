"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import { BadgeCheck } from "lucide-react";

const ease = [0.22, 0.61, 0.36, 1] as const;

const steps = [
  {
    number: "01",
    title: "Ask a question",
    description:
      "Type your research question in plain language. Forge classifies the type and routes to the right sources across 200M+ publications.",
    accent: "violet",
    mockup: (
      <div className="border border-border bg-white dark:bg-surface p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1.5 h-1.5 bg-violet animate-pulse" />
          <span className="text-[9px] font-semibold text-violet uppercase tracking-wider">
            Research query
          </span>
        </div>
        <p className="text-sm text-black/80 dark:text-foreground/80 leading-relaxed">
          &ldquo;What is the relationship between sleep deprivation and
          judicial decision-making?&rdquo;
        </p>
        <div className="mt-4 flex gap-2">
          <span className="text-[9px] font-medium px-2 py-1 bg-cyan/8 text-cyan border border-cyan/15">
            Empirical
          </span>
          <span className="text-[9px] font-medium px-2 py-1 bg-violet/8 text-violet border border-violet/15">
            Cross-domain
          </span>
          <span className="text-[9px] font-medium px-2 py-1 bg-warm/8 text-warm border border-warm/15">
            Legal + Neuro
          </span>
        </div>
      </div>
    ),
  },
  {
    number: "02",
    title: "Full papers read — not snippets",
    description:
      "Forge reads the entire methodology, sample size, limitations, and conclusions. Across every source, simultaneously.",
    accent: "cyan",
    mockup: (
      <div className="space-y-2">
        {[
          { title: "Cho et al. (2024)", journal: "Nature Neuroscience", status: "Reading...", progress: 78 },
          { title: "Danziger et al. (2011)", journal: "PNAS", status: "Complete", progress: 100 },
          { title: "Walker & Stickgold (2022)", journal: "Ann. Rev. Psychology", status: "Complete", progress: 100 },
          { title: "Lim & Dinges (2010)", journal: "Sleep Medicine Reviews", status: "Queued", progress: 0 },
        ].map((paper, i) => (
          <div key={i} className="border border-border bg-white dark:bg-surface px-4 py-3">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="min-w-0">
                <p className="text-xs text-black/80 dark:text-foreground/80 font-medium truncate">{paper.title}</p>
                <p className="text-[10px] text-muted mt-0.5">{paper.journal}</p>
              </div>
              <span className={`text-[9px] font-semibold shrink-0 ${
                paper.progress === 100 ? "text-green" : paper.progress > 0 ? "text-cyan" : "text-muted"
              }`}>
                {paper.status}
              </span>
            </div>
            <div className="h-[2px] bg-border overflow-hidden">
              <div
                className="h-full transition-all duration-700"
                style={{
                  width: `${paper.progress}%`,
                  background: paper.progress === 100 ? "var(--green)" : paper.progress > 0 ? "var(--cyan)" : "transparent",
                }}
              />
            </div>
          </div>
        ))}
      </div>
    ),
  },
  {
    number: "03",
    title: "Every citation verified",
    description:
      "Citations are checked against Crossref before entering your document. Green means confirmed. Nothing touches your work until it's verified.",
    accent: "green",
    mockup: (
      <div className="border border-border bg-white dark:bg-surface p-5">
        <p className="text-[13px] text-black/70 dark:text-foreground/70 leading-[1.9]">
          Sleep deprivation significantly impairs judicial cognition, with fatigued judges demonstrating{" "}
          <span className="inline px-1 py-0.5 bg-green/8 border-b-2 border-green text-black/90 dark:text-foreground/90">
            measurably harsher sentencing patterns
            <span className="text-[8px] text-green font-semibold ml-1">[1]</span>
          </span>{" "}
          and reduced capacity for{" "}
          <span className="inline px-1 py-0.5 bg-green/8 border-b-2 border-green text-black/90 dark:text-foreground/90">
            complex legal reasoning
            <span className="text-[8px] text-green font-semibold ml-1">[2]</span>
          </span>
          .
        </p>
        <div className="mt-4 pt-4 border-t border-border flex items-center gap-2">
          <BadgeCheck size={14} className="text-green" />
          <span className="text-[10px] text-green font-semibold tracking-wide">
            2 / 2 citations verified via Crossref
          </span>
        </div>
      </div>
    ),
  },
];

const accentColorMap: Record<string, string> = {
  violet: "bg-violet",
  cyan: "bg-cyan",
  green: "bg-green",
};

export default function HowItWorks() {
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: true, margin: "-80px" });

  return (
    <section
      ref={sectionRef}
      id="how-it-works"
      className="relative py-32 bg-background"
    >
      <div className="max-w-6xl mx-auto px-6">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.4, ease }}
          className="mb-20"
        >
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-[2px] bg-violet" />
            <span className="text-[11px] font-semibold text-violet uppercase tracking-[0.2em]">
              How it works
            </span>
          </div>
          <h2 className="font-display font-extrabold text-4xl sm:text-5xl lg:text-6xl text-black dark:text-foreground leading-[1.05] tracking-[-0.02em]">
            Question in.
            <br />
            <span className="text-gray">Verified research out.</span>
          </h2>
        </motion.div>

        {/* Timeline steps */}
        <div className="relative">
          {/* Vertical connecting line */}
          <div className="absolute left-6 lg:left-[calc(50%-1px)] top-0 bottom-0 w-[2px] bg-gradient-to-b from-violet via-cyan to-green hidden lg:block" />

          <div className="space-y-16 lg:space-y-24">
            {steps.map((step, index) => {
              const isEven = index % 2 === 0;

              return (
                <motion.div
                  key={step.number}
                  initial={{ opacity: 0, y: 40 }}
                  animate={isInView ? { opacity: 1, y: 0 } : {}}
                  transition={{ duration: 0.5, delay: 0.15 * index, ease }}
                  className="relative"
                >
                  <div className={`grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-center ${
                    !isEven ? "lg:[direction:rtl]" : ""
                  }`}>
                    {/* Content side */}
                    <div className={`${!isEven ? "lg:[direction:ltr]" : ""}`}>
                      {/* Step number indicator */}
                      <div className="flex items-center gap-4 mb-6">
                        <div className={`w-12 h-12 ${accentColorMap[step.accent]} flex items-center justify-center`}>
                          <span className="font-display font-black text-lg text-white leading-none">
                            {step.number}
                          </span>
                        </div>
                        <div className="h-[2px] w-12 bg-border" />
                      </div>

                      <h3 className="font-display font-bold text-2xl sm:text-3xl text-black dark:text-foreground tracking-tight mb-4">
                        {step.title}
                      </h3>
                      <p className="text-base text-gray leading-relaxed max-w-md">
                        {step.description}
                      </p>
                    </div>

                    {/* Mockup side */}
                    <div className={`${!isEven ? "lg:[direction:ltr]" : ""}`}>
                      <div className="relative">
                        {/* Subtle accent glow behind mockup */}
                        <div className={`absolute -inset-4 ${accentColorMap[step.accent]}/[0.04] blur-2xl pointer-events-none`} />
                        <div className="relative">
                          {step.mockup}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Timeline dot — desktop only */}
                  <div className="hidden lg:block absolute left-[calc(50%-8px)] top-6">
                    <div className={`w-4 h-4 ${accentColorMap[step.accent]} border-4 border-background`} />
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
