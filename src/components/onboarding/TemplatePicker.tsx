"use client";

/**
 * TemplatePicker — first-run wizard offering one of five starter
 * project templates. Matches Forge's "Obsidian Ink" scheme: sharp
 * edges, eyebrow uppercase tracking, left-rule accent on hero card,
 * framer-motion fade-in on cards.
 *
 * Pure presentation. The parent decides what "instantiate" does
 * (create a project, navigate, etc.).
 */

import { motion } from "framer-motion";
import { Sparkles, ArrowRight, Briefcase, FlaskConical, Scale, ScrollText, Gavel } from "lucide-react";
import { listTemplates, type Template, type TemplateKey } from "@/lib/templates";

const ease = [0.22, 0.61, 0.36, 1] as const;

const ICONS: Record<TemplateKey, typeof Briefcase> = {
  founder:    Briefcase,
  researcher: FlaskConical,
  consultant: Scale,
  policy:     ScrollText,
  legal:      Gavel,
};

const TONE_CLASS: Record<Template["tone"], { accent: string; bg: string }> = {
  violet: { accent: "text-violet", bg: "bg-violet" },
  cyan:   { accent: "text-cyan",   bg: "bg-cyan"   },
  warm:   { accent: "text-warm",   bg: "bg-warm"   },
  rose:   { accent: "text-rose",   bg: "bg-rose"   },
  green:  { accent: "text-green",  bg: "bg-green"  },
};

export interface TemplatePickerProps {
  /** Called when a user clicks Use template. */
  onPick: (key: TemplateKey) => void;
  /** Optional skip CTA (start from scratch). */
  onSkip?: () => void;
}

export function TemplatePicker({ onPick, onSkip }: TemplatePickerProps) {
  const templates = listTemplates();
  return (
    <div className="max-w-5xl mx-auto py-12 px-4 sm:px-6">
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease }}
        className="mb-10"
      >
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-2 flex items-center gap-2">
          <Sparkles size={11} strokeWidth={1.75} />
          First-run · pick a starter
        </p>
        <h2 className="font-display font-extrabold text-3xl sm:text-4xl text-foreground tracking-[-0.025em] leading-[1.05]">
          Start with a <span className="text-violet">shape</span> that fits.
        </h2>
        <p className="text-[13px] text-muted mt-3 max-w-xl leading-relaxed">
          Each template seeds a project with realistic assertions, documents, habits, and goals — Sync and Pulse start producing signal immediately. Pick one. You can always start blank instead.
        </p>
      </motion.div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {templates.map((t, i) => {
          const Icon = ICONS[t.key];
          const tone = TONE_CLASS[t.tone];
          return (
            <motion.button
              key={t.key}
              onClick={() => onPick(t.key)}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: i * 0.05, ease }}
              className="group text-left border border-border bg-surface hover:border-violet hover:bg-violet/[0.04] transition-colors duration-150 p-5 relative overflow-hidden focus-ring"
            >
              <span aria-hidden className={`absolute left-0 top-0 w-[2px] h-full ${tone.bg}`} />
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className={`w-9 h-9 border border-border bg-background flex items-center justify-center ${tone.accent}`}>
                  <Icon size={14} strokeWidth={2} />
                </div>
                <span className="text-[10px] uppercase tracking-[0.15em] text-muted font-medium">
                  {t.project.mode}
                </span>
              </div>
              <h3 className="font-display font-bold text-foreground text-[18px] tracking-[-0.018em] leading-tight group-hover:text-violet transition-colors">
                {t.label}
              </h3>
              <p className={`text-[10px] uppercase tracking-[0.15em] mt-1 font-semibold ${tone.accent}`}>
                {t.blurb}
              </p>
              <p className="text-[12.5px] text-muted leading-relaxed mt-3">{t.why}</p>
              <div className="mt-4 flex items-center justify-between text-[11px] uppercase tracking-[0.12em] font-medium">
                <span className="text-muted tabular-nums">
                  {t.assertions.length} vars · {t.documents.length} docs · {t.habits.length} habits · {t.goals.length} goals
                </span>
                <span className={`inline-flex items-center gap-1 ${tone.accent} group-hover:gap-2 transition-all`}>
                  Use <ArrowRight size={11} strokeWidth={2.25} />
                </span>
              </div>
            </motion.button>
          );
        })}
      </div>

      {onSkip && (
        <div className="mt-8 text-center">
          <button
            onClick={onSkip}
            className="text-[11px] uppercase tracking-[0.12em] font-semibold text-muted hover:text-foreground transition-colors"
          >
            Start from scratch instead
          </button>
        </div>
      )}
    </div>
  );
}
