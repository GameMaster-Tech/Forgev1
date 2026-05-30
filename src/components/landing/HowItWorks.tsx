"use client";

/**
 * HowItWorks — the voice loop in three beats: Speak → Aria acts → It's done.
 * Light "Obsidian Ink" canvas to contrast the dark hero; indigo structure with
 * the amber voice accent. Each step animates in on scroll.
 */

import { motion } from "framer-motion";
import { Mic, Wand2, Check } from "lucide-react";

const ease = [0.22, 0.61, 0.36, 1] as const;

const steps = [
  {
    n: "01",
    icon: Mic,
    title: "Speak",
    body: "Press F2 and talk like you would to a teammate. “Open the launch project.” “Draft a brief on pricing.” “Add a focus block tomorrow at 9.”",
    accent: "var(--voice)",
  },
  {
    n: "02",
    icon: Wand2,
    title: "Aria acts",
    body: "Her cursor moves through the workspace — navigating, creating, scheduling, researching, writing — while she talks you through it. You watch it happen.",
    accent: "var(--violet)",
  },
  {
    n: "03",
    icon: Check,
    title: "It's done",
    body: "Real changes, saved and synced — documents written, events on your calendar, projects set up. No tab-juggling, no forms, no busywork.",
    accent: "var(--green)",
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="relative py-28 bg-background overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.025] dark:opacity-[0.04] pointer-events-none"
        style={{ backgroundImage: "radial-gradient(circle at 1px 1px, var(--foreground) 0.5px, transparent 0)", backgroundSize: "32px 32px" }}
      />
      <div className="relative max-w-6xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5, ease }}
          className="max-w-2xl mb-16"
        >
          <div className="flex items-center gap-3 mb-5">
            <span className="w-8 h-[2px]" style={{ background: "var(--voice)" }} />
            <span className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: "var(--voice)" }}>
              How it works
            </span>
          </div>
          <h2 className="font-display font-black text-[clamp(2rem,4.5vw,3.25rem)] leading-[1.05] tracking-[-0.03em] text-foreground">
            Three words in. <br />A workspace that moves itself.
          </h2>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {steps.map((s, i) => {
            const Icon = s.icon;
            return (
              <motion.div
                key={s.n}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.5, ease, delay: i * 0.12 }}
                className="relative rounded-[0.75rem] border border-border bg-foreground/[0.015] p-7 hover:bg-foreground/[0.03] transition-colors"
              >
                <div className="flex items-center justify-between mb-6">
                  <span
                    className="w-11 h-11 rounded-full flex items-center justify-center"
                    style={{ background: `color-mix(in srgb, ${s.accent} 14%, transparent)`, color: s.accent }}
                  >
                    <Icon size={18} strokeWidth={2.25} />
                  </span>
                  <span
                    className="font-display font-black text-[2rem] leading-none tabular-nums"
                    style={{ color: `color-mix(in srgb, ${s.accent} 30%, var(--border))` }}
                  >
                    {s.n}
                  </span>
                </div>
                <h3 className="font-display font-bold text-foreground text-xl tracking-[-0.01em] mb-2.5">
                  {s.title}
                </h3>
                <p className="text-[13.5px] text-muted leading-relaxed">{s.body}</p>

                {i < steps.length - 1 && (
                  <div className="hidden md:block absolute top-1/2 -right-3 z-10 -translate-y-1/2 text-border">→</div>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
