"use client";

import Link from "next/link";
import { ArrowRight, BadgeCheck, BookOpen, Microscope } from "lucide-react";
import { motion } from "framer-motion";

const ease = [0.22, 0.61, 0.36, 1] as const;

const floatingBadges = [
  { label: "200M+ Sources", icon: BookOpen, color: "text-cyan", bg: "bg-cyan/10", border: "border-cyan/20", x: "right-0 lg:right-8", y: "top-12" },
  { label: "DOI Verified", icon: BadgeCheck, color: "text-green", bg: "bg-green/10", border: "border-green/20", x: "right-4 lg:right-0", y: "top-48" },
  { label: "Deep Analysis", icon: Microscope, color: "text-violet", bg: "bg-violet/10", border: "border-violet/20", x: "right-12 lg:right-16", y: "bottom-24" },
];

export default function Hero() {
  return (
    <section className="relative min-h-screen flex items-center overflow-hidden pt-20">
      {/* Background layers */}
      <div className="absolute inset-0 bg-background" />
      <div
        className="absolute inset-0 opacity-[0.03] dark:opacity-[0.04]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, var(--foreground) 0.5px, transparent 0)",
          backgroundSize: "32px 32px",
        }}
      />
      {/* Dramatic gradient wash */}
      <div className="absolute top-0 right-0 w-[70%] h-full bg-gradient-to-bl from-violet/[0.06] via-transparent to-transparent pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[50%] h-[60%] bg-gradient-to-tr from-cyan/[0.04] via-transparent to-transparent pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-6 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-8 items-center min-h-[85vh]">
          {/* Left — Content */}
          <div className="max-w-xl">
            {/* Overline */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, ease }}
              className="flex items-center gap-3 mb-8"
            >
              <div className="w-8 h-[2px] bg-violet" />
              <span className="text-[11px] font-semibold text-violet uppercase tracking-[0.2em]">
                AI Research Workspace
              </span>
            </motion.div>

            {/* Headline */}
            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease, delay: 0.08 }}
              className="font-display font-extrabold text-[clamp(2.5rem,6vw,4.5rem)] leading-[1.05] tracking-[-0.03em] text-black dark:text-foreground mb-6"
            >
              Stop juggling
              <br />
              five tabs.
              <br />
              <span className="relative inline-block">
                <span className="relative z-10 bg-gradient-to-r from-violet via-violet to-cyan bg-clip-text text-transparent">
                  Start forging.
                </span>
              </span>
            </motion.h1>

            {/* Subheadline */}
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease, delay: 0.16 }}
              className="text-lg text-gray leading-relaxed mb-10 max-w-md"
            >
              One workspace. 200M+ sources searched, read, and cited —
              with every reference DOI-verified before it touches your document.
            </motion.p>

            {/* CTAs */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease, delay: 0.24 }}
              className="flex flex-col sm:flex-row items-start gap-4 mb-12"
            >
              <Link
                href="/auth/signup"
                className="group relative flex items-center gap-3 bg-violet text-white px-8 py-4 text-base font-semibold overflow-hidden btn-glow-violet"
              >
                <span className="relative z-10">Start free — no card needed</span>
                <ArrowRight
                  size={16}
                  className="relative z-10 group-hover:translate-x-1 transition-transform duration-200"
                />
              </Link>
              <a
                href="#how-it-works"
                className="flex items-center gap-2 text-gray hover:text-black dark:hover:text-foreground border border-border hover:border-violet/40 px-6 py-4 transition-all duration-200 text-base"
              >
                See how it works
              </a>
            </motion.div>

            {/* Stats strip */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, ease, delay: 0.32 }}
              className="flex items-center gap-8"
            >
              {[
                { value: "200M+", label: "Sources" },
                { value: "150M+", label: "Verified DOIs" },
                { value: "<2s", label: "Avg. Response" },
              ].map((stat, i) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease, delay: 0.4 + i * 0.06 }}
                >
                  <div className="font-display font-bold text-xl text-black dark:text-foreground">
                    {stat.value}
                  </div>
                  <div className="text-[10px] text-muted uppercase tracking-wider mt-0.5">
                    {stat.label}
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </div>

          {/* Right — Product mockup */}
          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, ease, delay: 0.2 }}
            className="relative hidden lg:block"
          >
            {/* Main mockup window */}
            <div className="relative bg-white dark:bg-surface border border-border shadow-2xl dark:shadow-[0_25px_50px_rgba(0,0,0,0.5)]">
              {/* Window chrome */}
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-surface-light dark:bg-surface">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 bg-red/60" />
                  <div className="w-2.5 h-2.5 bg-amber/60" />
                  <div className="w-2.5 h-2.5 bg-green/60" />
                </div>
                <div className="flex-1 mx-8">
                  <div className="h-5 bg-background border border-border flex items-center px-3">
                    <span className="text-[9px] text-muted">forge.research/project/sleep-cognition</span>
                  </div>
                </div>
              </div>

              {/* Content area */}
              <div className="p-6 space-y-4">
                {/* Search bar mockup */}
                <div className="border border-violet/30 bg-violet/[0.03] p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-1.5 h-1.5 bg-violet animate-pulse" />
                    <span className="text-[9px] font-semibold text-violet uppercase tracking-wider">Research Query</span>
                  </div>
                  <p className="text-sm text-black/70 dark:text-foreground/70">
                    &ldquo;Impact of sleep deprivation on judicial decision-making&rdquo;
                  </p>
                </div>

                {/* Results mockup */}
                <div className="space-y-2">
                  {[
                    { title: "Cho et al. (2024)", journal: "Nature Neuroscience", verified: true },
                    { title: "Danziger et al. (2011)", journal: "PNAS", verified: true },
                    { title: "Walker & Stickgold (2022)", journal: "Ann. Rev. Psychology", verified: true },
                  ].map((paper, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: 12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.3, ease, delay: 0.8 + i * 0.12 }}
                      className="flex items-center justify-between border border-border px-3 py-2.5 bg-white dark:bg-surface"
                    >
                      <div>
                        <p className="text-xs font-medium text-black/80 dark:text-foreground/80">{paper.title}</p>
                        <p className="text-[10px] text-muted">{paper.journal}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <BadgeCheck size={12} className="text-green" />
                        <span className="text-[9px] text-green font-semibold">Verified</span>
                      </div>
                    </motion.div>
                  ))}
                </div>

                {/* Writing area mockup */}
                <div className="border border-border p-4 bg-surface-light dark:bg-surface-light">
                  <p className="text-[11px] text-black/60 dark:text-foreground/60 leading-[1.8]">
                    Sleep deprivation significantly impairs judicial cognition, with fatigued judges demonstrating{" "}
                    <span className="bg-green/10 border-b-2 border-green px-0.5">
                      measurably harsher sentencing
                      <sup className="text-[7px] text-green font-bold ml-0.5">[1]</sup>
                    </span>{" "}
                    and reduced capacity for complex reasoning...
                  </p>
                </div>
              </div>
            </div>

            {/* Floating badges */}
            {floatingBadges.map((badge, i) => {
              const Icon = badge.icon;
              return (
                <motion.div
                  key={badge.label}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.4, ease, delay: 1.2 + i * 0.15 }}
                  className={`absolute ${badge.x} ${badge.y} flex items-center gap-2 px-3 py-2 ${badge.bg} border ${badge.border} backdrop-blur-sm shadow-lg`}
                >
                  <Icon size={12} className={badge.color} />
                  <span className={`text-[10px] font-semibold ${badge.color}`}>{badge.label}</span>
                </motion.div>
              );
            })}
          </motion.div>
        </div>
      </div>
    </section>
  );
}
