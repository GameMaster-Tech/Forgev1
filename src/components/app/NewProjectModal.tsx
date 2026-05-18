"use client";

/**
 * NewProjectModal — landing-aligned design.
 *
 * Two-step wizard rendered with the same tokens the marketing pages use:
 * font-display (Urbanist) for headers, sharp edges, hairline borders,
 * violet primary, cyan/warm/rose for status. No bespoke theme classes.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  X,
  Zap,
  Brain,
  Microscope,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  ShieldCheck,
  Loader2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useProjectsStore, type ResearchMode } from "@/store/projects";
import { useAuth } from "@/context/AuthContext";
import { useFocusTrap } from "@/hooks/useFocusTrap";

const ease = [0.22, 0.61, 0.36, 1] as const;

interface NewProjectModalProps {
  open: boolean;
  onClose: () => void;
}

type ModeSpec = {
  id: ResearchMode;
  label: string;
  description: string;
  detail: string;
  icon: typeof Zap;
  accent: string;
  accentBg: string;
  dots: number;
  features: string[];
};

const MODES: ModeSpec[] = [
  {
    id: "lightning",
    label: "Lightning",
    description: "Snappy chat. Surface answers fast.",
    detail: "3 sources · abstract-only · ~5s",
    icon: Zap,
    accent: "text-warm",
    accentBg: "bg-warm",
    dots: 3,
    features: ["3 sources per query", "Abstract-only analysis", "≈ 5 second response"],
  },
  {
    id: "reasoning",
    label: "Reasoning",
    description: "Step-by-step with verification.",
    detail: "5 sources · highlights · DOI verify",
    icon: Brain,
    accent: "text-cyan",
    accentBg: "bg-cyan",
    dots: 5,
    features: ["5 sources per query", "Key highlights extracted", "DOI verification"],
  },
  {
    id: "deep",
    label: "Deep Research",
    description: "Long synthesis across project memory.",
    detail: "10 sources · full-text · cross-ref",
    icon: Microscope,
    accent: "text-rose",
    accentBg: "bg-rose",
    dots: 10,
    features: ["10+ sources per query", "Full-text analysis", "Cross-reference checking"],
  },
];

const SUGGESTIONS = [
  "Focus on peer-reviewed sources from 2020-2026",
  "Prioritize systematic reviews and meta-analyses",
  "Use APA citation format",
  "Always include sample sizes",
  "Focus on qualitative methods",
];

export default function NewProjectModal({ open, onClose }: NewProjectModalProps) {
  const router = useRouter();
  const { user } = useAuth();
  const addProject = useProjectsStore((s) => s.addProject);

  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<ResearchMode>("reasoning");
  const [instructions, setInstructions] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setStep(1);
    setName("");
    setMode("reasoning");
    setInstructions("");
    setCreating(false);
    setError("");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const trapRef = useFocusTrap<HTMLDivElement>({ active: open, onClose: handleClose });

  const handleCreate = async () => {
    if (!name.trim() || !user?.uid) return;
    setCreating(true);
    setError("");
    try {
      const id = await Promise.race([
        addProject(user.uid, {
          name: name.trim(),
          mode,
          systemInstructions: instructions.trim(),
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Request timed out. Ensure Firestore is enabled and security rules deployed.")),
            15000
          )
        ),
      ]);
      handleClose();
      router.push(`/project/${id}`);
    } catch (err) {
      console.error("Failed to create project:", err);
      setError(err instanceof Error ? err.message : "Failed to create project.");
    } finally {
      setCreating(false);
    }
  };

  const selected = MODES.find((m) => m.id === mode)!;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm"
            onClick={handleClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 6 }}
            transition={{ duration: 0.22, ease }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
          >
            <div
              ref={trapRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="new-project-title"
              onClick={(e) => e.stopPropagation()}
              className="pointer-events-auto w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-surface border border-border shadow-[0_24px_56px_-20px_rgba(0,0,0,0.35)] relative"
            >
              <div className="flex items-center justify-between px-6 py-5 border-b border-border">
                <div className="flex items-center gap-3.5">
                  <div className="w-9 h-9 border border-border bg-background flex items-center justify-center">
                    <Sparkles size={15} className="text-violet" strokeWidth={1.75} />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-1">
                      New workspace
                    </div>
                    <h2 id="new-project-title" className="font-display text-[17px] font-semibold text-foreground leading-none tracking-[-0.01em]">
                      Create project
                    </h2>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-[10px] uppercase tracking-[0.15em] text-muted tabular-nums font-medium">
                    {step.toString().padStart(2, "0")}
                    <span className="text-muted/50"> / 02</span>
                  </div>
                  <button
                    onClick={handleClose}
                    className="text-muted hover:text-foreground transition-colors p-1.5"
                    aria-label="Close new-project wizard"
                  >
                    <X size={15} strokeWidth={1.75} aria-hidden />
                  </button>
                </div>
              </div>

              <div className="h-[1px] bg-border">
                <motion.div
                  className="h-full bg-violet"
                  initial={{ width: "50%" }}
                  animate={{ width: step === 1 ? "50%" : "100%" }}
                  transition={{ duration: 0.3, ease }}
                />
              </div>

              <AnimatePresence mode="wait">
                {step === 1 ? (
                  <motion.div
                    key="step1"
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -8 }}
                    transition={{ duration: 0.2, ease }}
                    className="p-6"
                  >
                    <div className="mb-7">
                      <div className="flex items-center gap-2.5 mb-3">
                        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted tabular-nums">
                          01
                        </span>
                        <div className="w-5 h-px bg-border" />
                        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-foreground">
                          Project name
                        </span>
                      </div>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Sleep & Judicial Decision-Making"
                        autoFocus
                        className="w-full bg-background border border-border text-foreground px-4 py-3 text-[14px] focus:border-violet focus:outline-none transition-colors duration-150 placeholder:text-muted"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && name.trim()) setStep(2);
                        }}
                      />
                    </div>

                    <div>
                      <div className="flex items-center gap-2.5 mb-3">
                        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted tabular-nums">
                          02
                        </span>
                        <div className="w-5 h-px bg-border" />
                        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-foreground">
                          Research mode
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 border border-border">
                        {MODES.map((m, idx) => {
                          const Icon = m.icon;
                          const sel = mode === m.id;
                          return (
                            <button
                              key={m.id}
                              onClick={() => setMode(m.id)}
                              className={`relative text-left p-4 transition-colors duration-150 ${
                                idx > 0 ? "sm:border-l border-border" : ""
                              } ${sel ? "bg-violet/[0.04]" : "bg-surface hover:bg-background/60"}`}
                            >
                              {sel && <div className="absolute top-0 left-0 w-[2px] h-full bg-violet" />}
                              <div className="flex items-start justify-between mb-3">
                                <div
                                  className={`w-9 h-9 border flex items-center justify-center transition-colors ${
                                    sel ? "border-violet/30 bg-background" : "border-border bg-background"
                                  }`}
                                >
                                  <Icon size={15} strokeWidth={1.75} className={sel ? m.accent : "text-muted"} />
                                </div>
                                {sel && (
                                  <span className="text-[9px] font-medium uppercase tracking-[0.15em] text-violet">
                                    Selected
                                  </span>
                                )}
                              </div>

                              <div className="flex gap-[2px] mb-2">
                                {Array.from({ length: m.dots }).map((_, i) => (
                                  <div
                                    key={i}
                                    className={`h-[2px] flex-1 transition-colors ${sel ? m.accentBg : "bg-border"}`}
                                  />
                                ))}
                              </div>
                              <span className="text-[9px] uppercase tracking-[0.12em] text-muted tabular-nums font-medium">
                                {m.dots} sources
                              </span>

                              <h4 className="font-display text-[15px] font-semibold text-foreground tracking-[-0.01em] mt-3 mb-1">
                                {m.label}
                              </h4>
                              <p className="text-[11px] text-muted leading-relaxed">{m.description}</p>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex justify-end mt-7">
                      <button
                        onClick={() => name.trim() && setStep(2)}
                        disabled={!name.trim()}
                        className="flex items-center gap-2 bg-violet text-white hover:bg-violet/90 text-[11px] font-semibold uppercase tracking-[0.12em] px-5 py-2.5 transition-colors duration-150 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        Next step
                        <ArrowRight size={12} strokeWidth={2} />
                      </button>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="step2"
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 8 }}
                    transition={{ duration: 0.2, ease }}
                    className="p-6"
                  >
                    <div className="flex items-center gap-4 mb-6 p-4 border border-border bg-background/60 relative">
                      <div className="absolute top-0 left-0 w-[2px] h-full bg-violet" />
                      <div className="w-10 h-10 border border-border bg-surface flex items-center justify-center shrink-0">
                        <selected.icon size={15} strokeWidth={1.75} className={selected.accent} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className={`text-[9px] font-semibold uppercase tracking-[0.15em] ${selected.accent}`}>
                            {selected.label}
                          </span>
                          <span className="w-0.5 h-0.5 bg-muted" />
                          <span className="text-[10px] uppercase tracking-[0.12em] text-muted">
                            {selected.detail}
                          </span>
                        </div>
                        <p className="font-display text-[15px] font-semibold text-foreground truncate tracking-[-0.01em]">
                          {name}
                        </p>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center gap-2.5 mb-3">
                        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted tabular-nums">
                          03
                        </span>
                        <div className="w-5 h-px bg-border" />
                        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-foreground">
                          System instructions
                        </span>
                        <span className="text-[10px] text-muted/70 ml-1">(optional)</span>
                      </div>
                      <textarea
                        value={instructions}
                        onChange={(e) => setInstructions(e.target.value)}
                        placeholder="Guide how Forge approaches research for this project…"
                        autoFocus
                        rows={4}
                        className="w-full bg-background border border-border text-foreground px-4 py-3 text-[13px] focus:border-violet focus:outline-none transition-colors duration-150 placeholder:text-muted resize-none leading-relaxed"
                      />

                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {SUGGESTIONS.map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() =>
                              setInstructions((prev) => (prev ? `${prev}\n${s}` : s))
                            }
                            className="text-[10px] text-muted hover:text-foreground hover:border-violet/40 px-2.5 py-1.5 border border-border bg-surface transition-colors"
                          >
                            + {s}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="mt-6 p-4 border border-border bg-background/60 relative">
                      <div className={`absolute top-0 left-0 w-[2px] h-full ${selected.accentBg} opacity-60`} />
                      <div className="flex items-center gap-2.5 mb-3">
                        <span className={`text-[10px] font-semibold uppercase tracking-[0.15em] ${selected.accent}`}>
                          What you get
                        </span>
                        <span className="h-px flex-1 bg-border" />
                      </div>
                      <div className="space-y-2">
                        {selected.features.map((f) => (
                          <div key={f} className="flex items-center gap-2.5">
                            <div className="w-4 h-4 border border-border bg-surface flex items-center justify-center shrink-0">
                              <ShieldCheck size={9} className={selected.accent} strokeWidth={2.25} />
                            </div>
                            <span className="text-[12px] text-foreground">{f}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {error && (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mt-4 p-3 border border-rose/40 bg-rose/[0.05] text-rose text-[11px] leading-relaxed"
                      >
                        {error}
                      </motion.div>
                    )}

                    <div className="flex items-center justify-between mt-7">
                      <button
                        onClick={() => setStep(1)}
                        className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] font-semibold text-muted hover:text-foreground px-3 py-2 transition-colors"
                      >
                        <ArrowLeft size={12} strokeWidth={2} />
                        Back
                      </button>
                      <button
                        onClick={handleCreate}
                        disabled={creating}
                        className="flex items-center gap-2 bg-violet text-white text-[11px] font-semibold uppercase tracking-[0.12em] px-5 py-2.5 hover:bg-violet/90 transition-colors duration-150 disabled:opacity-50"
                      >
                        {creating ? (
                          <>
                            <Loader2 size={12} className="animate-spin" />
                            Creating
                          </>
                        ) : (
                          <>
                            Create project
                            <ArrowRight size={12} strokeWidth={2} />
                          </>
                        )}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
