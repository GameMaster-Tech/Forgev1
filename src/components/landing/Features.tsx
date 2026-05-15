"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import { Search, PenTool, ShieldCheck, ArrowUpRight } from "lucide-react";

const ease = [0.22, 0.61, 0.36, 1] as const;

const features = [
  {
    number: "01",
    icon: Search,
    title: "Research Engine",
    subtitle: "200M+ sources. Full-text retrieval.",
    description:
      "Type a question. Forge searches across arXiv, PubMed, SSRN, DOAJ, bioRxiv, and Semantic Scholar simultaneously. It reads the entire paper — methodology, sample size, limitations — not just the abstract.",
    badge: "200M+ sources",
    accent: "cyan",
    mockup: (
      <div className="space-y-2 mt-6">
        {["arXiv", "PubMed", "SSRN", "Semantic Scholar", "bioRxiv"].map(
          (src, i) => (
            <div
              key={src}
              className="flex items-center justify-between px-3 py-2 border border-border bg-white dark:bg-surface"
            >
              <span className="text-[11px] font-medium text-black/70 dark:text-foreground/70">
                {src}
              </span>
              <div className="flex items-center gap-2">
                <div
                  className="h-1 bg-cyan/30 overflow-hidden"
                  style={{ width: `${60 + i * 8}px` }}
                >
                  <div
                    className="h-full bg-cyan"
                    style={{ width: `${70 + i * 6}%` }}
                  />
                </div>
                <span className="text-[9px] text-muted">{23 + i * 7}</span>
              </div>
            </div>
          )
        )}
      </div>
    ),
  },
  {
    number: "02",
    icon: PenTool,
    title: "AI Text Editor",
    subtitle: "Plain text. All disciplines.",
    description:
      "A clean editor where research flows directly into writing. Works for humanities, law, medicine, social science, policy — citations insert automatically as you write.",
    badge: "Every discipline",
    accent: "warm",
    mockup: (
      <div className="mt-6 border border-border bg-white dark:bg-surface p-4">
        <div className="space-y-2">
          <div className="h-2 bg-black/10 dark:bg-white/10 w-full" />
          <div className="h-2 bg-black/10 dark:bg-white/10 w-[85%]" />
          <div className="h-2 bg-warm/20 w-[60%]" />
          <div className="h-2 bg-black/10 dark:bg-white/10 w-[92%]" />
          <div className="h-2 bg-black/10 dark:bg-white/10 w-[70%]" />
        </div>
        <div className="mt-3 pt-3 border-t border-border flex items-center gap-2">
          <div className="w-4 h-4 bg-warm/15 border border-warm/30 flex items-center justify-center">
            <PenTool size={8} className="text-warm" />
          </div>
          <span className="text-[9px] text-warm font-medium">AI writing active</span>
        </div>
      </div>
    ),
  },
  {
    number: "03",
    icon: ShieldCheck,
    title: "Auto Citation Manager",
    subtitle: "Every citation DOI-verified in real time.",
    description:
      "Every citation is verified against Crossref — 150M publications. Forge confirms the paper exists, retrieves verified metadata, and stores it. Nothing enters your document until confirmed.",
    badge: "150M+ verified",
    accent: "green",
    mockup: (
      <div className="mt-6 space-y-2">
        {[
          { doi: "10.1038/s41593-024-1234", status: "Verified", color: "green" },
          { doi: "10.1073/pnas.2011123456", status: "Verified", color: "green" },
          { doi: "10.1146/annurev-psych-22", status: "Checking...", color: "amber" },
        ].map((cite) => (
          <div
            key={cite.doi}
            className="flex items-center justify-between px-3 py-2 border border-border bg-white dark:bg-surface"
          >
            <code className="text-[10px] text-muted font-mono">{cite.doi}</code>
            <span
              className={`text-[9px] font-semibold text-${cite.color}`}
            >
              {cite.status}
            </span>
          </div>
        ))}
      </div>
    ),
  },
];

const accentMap: Record<string, { text: string; bg: string; border: string }> = {
  cyan: { text: "text-cyan", bg: "bg-cyan/8", border: "border-cyan/20" },
  warm: { text: "text-warm", bg: "bg-warm/8", border: "border-warm/20" },
  green: { text: "text-green", bg: "bg-green/8", border: "border-green/20" },
};

export default function Features() {
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: true, margin: "-100px" });

  return (
    <section
      ref={sectionRef}
      id="features"
      className="relative py-32 bg-white dark:bg-surface"
    >
      <div className="max-w-7xl mx-auto px-6">
        {/* Section header */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mb-16">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.4, ease }}
            className="lg:col-span-7"
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="w-8 h-[2px] bg-violet" />
              <span className="text-[11px] font-semibold text-violet uppercase tracking-[0.2em]">
                Core Platform
              </span>
            </div>
            <h2 className="font-display font-extrabold text-4xl sm:text-5xl lg:text-6xl text-black dark:text-foreground leading-[1.05] tracking-[-0.02em]">
              Three tools.
              <br />
              <span className="text-gray">One research loop.</span>
            </h2>
          </motion.div>
          <motion.div
            initial={{ opacity: 0 }}
            animate={isInView ? { opacity: 1 } : {}}
            transition={{ duration: 0.4, ease, delay: 0.15 }}
            className="lg:col-span-5 flex items-end"
          >
            <p className="text-base text-gray leading-relaxed max-w-md">
              Search, write, and verify — in a single tab. No more copying between apps.
              No more hallucinated references.
            </p>
          </motion.div>
        </div>

        {/* Bento grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            const colors = accentMap[feature.accent];
            const isLarge = index === 0;

            return (
              <motion.div
                key={feature.number}
                initial={{ opacity: 0, y: 24 }}
                animate={isInView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.4, delay: 0.1 * index, ease }}
                className={`group relative border border-border bg-surface-light dark:bg-background hover:border-border-light dark:hover:border-white/10 transition-all duration-300 overflow-hidden ${
                  isLarge ? "lg:col-span-7 p-8 sm:p-10" : "lg:col-span-5 p-8"
                }`}
              >
                {/* Ghost number */}
                <span className="absolute top-4 right-6 font-display font-black text-[6rem] leading-none text-black/[0.03] dark:text-white/[0.03] select-none pointer-events-none">
                  {feature.number}
                </span>

                <div className="relative">
                  {/* Header */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 ${colors.bg} border ${colors.border} flex items-center justify-center`}>
                        <Icon size={18} className={colors.text} />
                      </div>
                      <div>
                        <h3 className="font-display font-bold text-lg text-black dark:text-foreground tracking-tight">
                          {feature.title}
                        </h3>
                        <p className="text-[11px] text-muted mt-0.5">{feature.subtitle}</p>
                      </div>
                    </div>
                    <ArrowUpRight
                      size={16}
                      className="text-muted opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all duration-200"
                    />
                  </div>

                  {/* Badge */}
                  <span className={`inline-flex text-[9px] font-semibold uppercase tracking-wider px-2.5 py-1 ${colors.bg} ${colors.text} border ${colors.border} mb-4`}>
                    {feature.badge}
                  </span>

                  {/* Description */}
                  <p className="text-sm text-muted leading-[1.75] max-w-lg">
                    {feature.description}
                  </p>

                  {/* Mockup */}
                  <div className="opacity-80 group-hover:opacity-100 transition-opacity duration-300">
                    {feature.mockup}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
