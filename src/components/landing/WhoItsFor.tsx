"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import {
  GraduationCap,
  Briefcase,
  BarChart3,
  Newspaper,
  Landmark,
  Scale,
} from "lucide-react";

const ease = [0.22, 0.61, 0.36, 1] as const;

const personas = [
  {
    icon: GraduationCap,
    title: "Graduate Students",
    use: "Dissertations & thesis papers",
    quote: "I spent 40% of my time just verifying citations existed.",
    accent: "violet",
  },
  {
    icon: Briefcase,
    title: "Consultants",
    use: "Evidence-based deliverables",
    quote: "A client caught a hallucinated citation. Never again.",
    accent: "cyan",
  },
  {
    icon: BarChart3,
    title: "Analysts",
    use: "Policy briefs & market research",
    quote: "Five tools for one research question was my reality.",
    accent: "warm",
  },
  {
    icon: Newspaper,
    title: "Journalists",
    use: "Investigative reporting",
    quote: "I need sources I can trust, not sources that sound right.",
    accent: "green",
  },
  {
    icon: Landmark,
    title: "Policy Researchers",
    use: "Government reports & regulation",
    quote: "In policy work, one wrong citation can derail legislation.",
    accent: "violet",
  },
  {
    icon: Scale,
    title: "Legal Professionals",
    use: "Case law & legal memoranda",
    quote: "Every research tool is built for STEM. Not us. Until now.",
    accent: "cyan",
  },
];

const accentColors: Record<string, { text: string; bg: string; border: string; line: string }> = {
  violet: { text: "text-violet", bg: "bg-violet/8", border: "border-violet/15", line: "bg-violet" },
  cyan: { text: "text-cyan", bg: "bg-cyan/8", border: "border-cyan/15", line: "bg-cyan" },
  warm: { text: "text-warm", bg: "bg-warm/8", border: "border-warm/15", line: "bg-warm" },
  green: { text: "text-green", bg: "bg-green/8", border: "border-green/15", line: "bg-green" },
};

export default function WhoItsFor() {
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: true, margin: "-80px" });

  return (
    <section ref={sectionRef} className="relative py-32 bg-white dark:bg-surface overflow-hidden">
      <div className="max-w-7xl mx-auto px-6">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.4, ease }}
          className="mb-16"
        >
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-[2px] bg-violet" />
            <span className="text-[11px] font-semibold text-violet uppercase tracking-[0.2em]">
              Built for
            </span>
          </div>
          <h2 className="font-display font-extrabold text-4xl sm:text-5xl lg:text-6xl text-black dark:text-foreground leading-[1.05] tracking-[-0.02em]">
            For everyone whose work
            <br />
            <span className="text-gray">has to be right.</span>
          </h2>
        </motion.div>

        {/* Persona cards — editorial grid */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.4, ease, delay: 0.1 }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-0 border border-border"
        >
          {personas.map((persona, i) => {
            const Icon = persona.icon;
            const colors = accentColors[persona.accent];
            return (
              <motion.div
                key={persona.title}
                initial={{ opacity: 0 }}
                animate={isInView ? { opacity: 1 } : {}}
                transition={{ duration: 0.3, delay: 0.05 * i, ease }}
                className={`group relative p-8 bg-white dark:bg-surface hover:bg-surface-light dark:hover:bg-background transition-colors duration-300 ${
                  i % 3 !== 2 ? "lg:border-r border-border" : ""
                } ${i < 3 ? "border-b border-border" : "sm:border-b lg:border-b-0 border-border"} ${
                  i % 2 !== 1 || i >= 4 ? "sm:border-r lg:border-r-0" : ""
                } ${i < 4 ? "sm:border-b" : "sm:border-b-0"} ${i % 3 !== 2 ? "" : ""}`}
                style={{
                  borderRight: i % 3 !== 2 ? undefined : "none",
                  borderBottom: i < 3 ? undefined : "none",
                }}
              >
                {/* Number */}
                <span className="font-display font-black text-5xl text-black/[0.04] dark:text-white/[0.04] absolute top-4 right-6 select-none pointer-events-none">
                  {String(i + 1).padStart(2, "0")}
                </span>

                {/* Icon */}
                <div className={`w-10 h-10 ${colors.bg} border ${colors.border} flex items-center justify-center mb-5`}>
                  <Icon size={18} className={colors.text} />
                </div>

                {/* Content */}
                <h3 className="font-display font-bold text-base text-black dark:text-foreground tracking-tight mb-1">
                  {persona.title}
                </h3>
                <p className="text-[11px] text-muted mb-5">
                  {persona.use}
                </p>

                {/* Quote */}
                <div className="relative pl-4">
                  <div className={`absolute left-0 top-0 bottom-0 w-[2px] ${colors.line}`} />
                  <p className="text-[12px] text-gray leading-relaxed italic">
                    &ldquo;{persona.quote}&rdquo;
                  </p>
                </div>
              </motion.div>
            );
          })}
        </motion.div>

        {/* Pull quote */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.4, ease, delay: 0.25 }}
          className="mt-20 max-w-3xl mx-auto text-center"
        >
          <p className="text-xl sm:text-2xl font-display font-semibold text-black dark:text-foreground leading-relaxed tracking-tight">
            The existing tools were built for curiosity.
            <br />
            <span className="text-gray">Forge is built for work that has to be right.</span>
          </p>
        </motion.div>
      </div>
    </section>
  );
}
