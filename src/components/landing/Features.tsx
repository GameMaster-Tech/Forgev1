"use client";

/**
 * Features — what Aria can actually do, as a quiet, confident capability grid.
 * Voice-native messaging; indigo + amber on the light canvas.
 */

import { motion } from "framer-motion";
import { Compass, FileText, CalendarClock, Search, Sparkles, ShieldCheck } from "lucide-react";

const ease = [0.22, 0.61, 0.36, 1] as const;

const features = [
  { icon: Compass, title: "Navigate by voice", body: "Jump to any project, document, team, or calendar view — Aria's cursor walks there and opens it." },
  { icon: FileText, title: "Write & edit, hands-free", body: "“Draft a brief on X.” She creates the doc and types it into the live editor while you watch." },
  { icon: CalendarClock, title: "Plan your time", body: "Events, tasks, goals, and habits — created as real, synced records the moment you ask." },
  { icon: Search, title: "Research in the flow", body: "Ask a question out loud; Aria pulls it into Research without you ever leaving what you're doing." },
  { icon: Sparkles, title: "Sees what you see", body: "“Summarize this.” “What's on screen?” She reads your current view and answers in context." },
  { icon: ShieldCheck, title: "You stay in control", body: "Every destructive action is confirmed, every step is visible. Aria never hides what she's doing." },
];

export default function Features() {
  return (
    <section className="relative py-28 bg-background overflow-hidden">
      <div className="relative max-w-6xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5, ease }}
          className="max-w-2xl mb-14"
        >
          <div className="flex items-center gap-3 mb-5">
            <span className="w-8 h-[2px]" style={{ background: "var(--violet)" }} />
            <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-violet">
              One agent, your whole workspace
            </span>
          </div>
          <h2 className="font-display font-black text-[clamp(2rem,4.5vw,3.25rem)] leading-[1.05] tracking-[-0.03em] text-foreground">
            Everything you can do in Forge — <span style={{ color: "var(--voice)" }}>now you can just say.</span>
          </h2>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border rounded-[0.75rem] overflow-hidden border border-border">
          {features.map((f, i) => {
            const Icon = f.icon;
            return (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.45, ease, delay: (i % 3) * 0.08 }}
                className="group bg-background hover:bg-foreground/[0.025] transition-colors p-7"
              >
                <span className="inline-flex w-10 h-10 rounded-[0.5rem] items-center justify-center mb-5 text-violet group-hover:text-[color:var(--voice)] transition-colors" style={{ background: "color-mix(in srgb, var(--violet) 10%, transparent)" }}>
                  <Icon size={18} strokeWidth={2} />
                </span>
                <h3 className="font-display font-bold text-foreground text-[1.05rem] tracking-[-0.01em] mb-2">
                  {f.title}
                </h3>
                <p className="text-[13px] text-muted leading-relaxed">{f.body}</p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
