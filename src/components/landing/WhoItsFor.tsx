"use client";

/**
 * WhoItsFor — voice-native personas. Anyone who'd rather talk than click.
 * Light surface; indigo + amber accents; scroll-revealed editorial grid.
 */

import { motion } from "framer-motion";
import { PenLine, Rocket, Microscope, GraduationCap, Layers, Hand } from "lucide-react";

const ease = [0.22, 0.61, 0.36, 1] as const;

const personas = [
  { icon: Rocket, title: "Founders", use: "Move fast, hands full", quote: "Set up a project, draft the brief, block my focus time — while I keep thinking." },
  { icon: PenLine, title: "Writers", use: "Stay in the flow", quote: "I talk the outline; Aria writes it into the doc as I go." },
  { icon: Microscope, title: "Researchers", use: "Ask, don't dig", quote: "“Pull sources on X” — and it's open before I finish the sentence." },
  { icon: GraduationCap, title: "Students", use: "From blank page to draft", quote: "“Make a doc on the French Revolution” and it's already writing." },
  { icon: Layers, title: "PMs & operators", use: "Plan out loud", quote: "Goals, tasks, and a calendar that fills itself — by voice." },
  { icon: Hand, title: "Anyone hands-busy", use: "Cooking, commuting, pacing", quote: "I never touch the keyboard. I just say what I need." },
];

export default function WhoItsFor() {
  return (
    <section className="relative py-28 bg-foreground/[0.02] dark:bg-surface overflow-hidden">
      <div className="max-w-6xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5, ease }}
          className="mb-14"
        >
          <div className="flex items-center gap-3 mb-5">
            <span className="w-8 h-[2px]" style={{ background: "var(--voice)" }} />
            <span className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: "var(--voice)" }}>
              Who it's for
            </span>
          </div>
          <h2 className="font-display font-black text-[clamp(2rem,4.5vw,3.25rem)] leading-[1.05] tracking-[-0.03em] text-foreground">
            For everyone who'd rather <span style={{ color: "var(--voice)" }}>talk</span> than click.
          </h2>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border rounded-[0.75rem] overflow-hidden border border-border">
          {personas.map((p, i) => {
            const Icon = p.icon;
            return (
              <motion.div
                key={p.title}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.4, ease, delay: (i % 3) * 0.08 }}
                className="relative bg-background p-7"
              >
                <span className="font-display font-black text-4xl absolute top-4 right-5 select-none pointer-events-none text-foreground/[0.05]">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="inline-flex w-10 h-10 rounded-[0.5rem] items-center justify-center mb-5 text-violet" style={{ background: "color-mix(in srgb, var(--violet) 10%, transparent)" }}>
                  <Icon size={18} strokeWidth={2} />
                </span>
                <h3 className="font-display font-bold text-foreground text-[1.05rem] tracking-[-0.01em]">{p.title}</h3>
                <p className="text-[11px] uppercase tracking-[0.12em] text-muted mt-1 mb-4">{p.use}</p>
                <div className="relative pl-3.5">
                  <span className="absolute left-0 top-0 bottom-0 w-[2px]" style={{ background: "var(--voice)" }} />
                  <p className="text-[12.5px] text-muted leading-relaxed italic">“{p.quote}”</p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
