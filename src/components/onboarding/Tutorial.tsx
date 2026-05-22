"use client";

/**
 * First-run interactive tutorial.
 *
 * Mounts inside AppShell. Reads `users/{uid}.tutorialCompleted` once;
 * if missing or false, opens a step-by-step overlay. The user can
 * skip; either action persists `tutorialCompleted: true` so the
 * overlay never reappears.
 *
 * Steps are short, plain, and link to the relevant route at the end.
 * No coachmark coordinates — the overlay sits centered above the
 * page so it works on every viewport without per-page anchors.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import {
  ArrowRight,
  ArrowLeft,
  Sparkles,
  X,
  FileText,
  Calendar as CalendarIcon,
  GitBranch,
  ShieldCheck,
  Check,
} from "lucide-react";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase/config";

const EASE = [0.22, 0.61, 0.36, 1] as const;
const STORAGE_KEY = "forge.tutorial.dismissed.v1";

interface Step {
  icon: typeof Sparkles;
  eyebrow: string;
  title: string;
  body: string;
  ctaLabel?: string;
  ctaHref?: string;
}

const STEPS: Step[] = [
  {
    icon: Sparkles,
    eyebrow: "Welcome",
    title: "Forge in 4 quick steps.",
    body: "Forge brings research, writing, and scheduling into one place. Let's walk through the parts you'll use most.",
  },
  {
    icon: FileText,
    eyebrow: "Step 1 · Projects",
    title: "Make a project.",
    body: "Every doc, source, and number lives inside a project. Start one for whatever you're working on — a paper, a launch, a deal.",
    ctaLabel: "Open projects",
    ctaHref: "/projects",
  },
  {
    icon: GitBranch,
    eyebrow: "Step 2 · Sync",
    title: "Keep your numbers honest.",
    body: "Sync watches the numbers across your docs and flags anything that contradicts. One click suggests a fix that lines everything up.",
    ctaLabel: "See Sync",
    ctaHref: "/sync",
  },
  {
    icon: CalendarIcon,
    eyebrow: "Step 3 · Calendar",
    title: "Plan your time.",
    body: "Connect Google Calendar, add events and tasks, and Tempo arranges your week around your focus and energy.",
    ctaLabel: "Open calendar",
    ctaHref: "/calendar",
  },
  {
    icon: ShieldCheck,
    eyebrow: "Step 4 · Rules",
    title: "Set guardrails.",
    body: "Add simple rules — like \"4 hours of deep work each day\" — and Forge will block any change that breaks them.",
    ctaLabel: "Build rules",
    ctaHref: "/calendar/compiler/invariants",
  },
];

export function Tutorial() {
  const { user, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  // Decide whether to open the tutorial on mount. We check Firestore
  // first; if the read fails (offline, rules not deployed yet), we fall
  // back to localStorage so first-run still works locally.
  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (cancelled) return;
        const data = snap.data() as { tutorialCompleted?: boolean } | undefined;
        if (data?.tutorialCompleted === true) return;
        const localDismissed =
          typeof window !== "undefined" &&
          window.localStorage.getItem(STORAGE_KEY) === "1";
        if (localDismissed) return;
        setOpen(true);
      } catch {
        const localDismissed =
          typeof window !== "undefined" &&
          window.localStorage.getItem(STORAGE_KEY) === "1";
        if (!localDismissed) setOpen(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  const dismiss = useCallback(async () => {
    setOpen(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, "1");
    }
    if (!user) return;
    try {
      await setDoc(
        doc(db, "users", user.uid),
        {
          tutorialCompleted: true,
          tutorialCompletedAt: serverTimestamp(),
        },
        { merge: true },
      );
    } catch {
      // Already mirrored to localStorage; persisting to Firestore is
      // best-effort. The next sign-in will retry via the same mount.
    }
  }, [user]);

  const next = useCallback(() => {
    setStepIndex((i) => Math.min(STEPS.length - 1, i + 1));
  }, []);

  const back = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  const step = useMemo(() => STEPS[stepIndex], [stepIndex]);
  const isLast = stepIndex === STEPS.length - 1;
  const isFirst = stepIndex === 0;

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="tutorial-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[80] bg-foreground/30 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.22, ease: EASE }}
            className="relative w-full max-w-lg bg-surface border border-border shadow-[0_24px_56px_-20px_rgba(0,0,0,0.35)]"
          >
            <span
              aria-hidden
              className="absolute left-0 top-6 bottom-6 w-[2px] bg-violet"
            />
            <button
              type="button"
              onClick={dismiss}
              aria-label="Skip tutorial"
              className="absolute top-3 right-3 text-muted hover:text-foreground transition-colors p-1.5"
            >
              <X size={14} strokeWidth={1.75} />
            </button>

            <div className="px-6 pt-7 pb-5">
              <div className="flex items-center gap-2 mb-3">
                <step.icon size={11} strokeWidth={2} className="text-violet" />
                <span className="text-[10px] uppercase tracking-[0.18em] text-violet font-semibold">
                  {step.eyebrow}
                </span>
              </div>
              <h2 className="font-display font-bold text-foreground text-2xl tracking-[-0.022em] leading-[1.1] mb-3">
                {step.title}
              </h2>
              <p className="text-[13px] text-muted leading-relaxed">
                {step.body}
              </p>
            </div>

            {/* Progress dots */}
            <div className="px-6 pb-4">
              <div className="flex items-center gap-1.5">
                {STEPS.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setStepIndex(i)}
                    aria-label={`Go to step ${i + 1}`}
                    className={`h-1 transition-all ${
                      i === stepIndex
                        ? "w-8 bg-violet"
                        : i < stepIndex
                          ? "w-4 bg-violet/40"
                          : "w-4 bg-border hover:bg-foreground/20"
                    }`}
                  />
                ))}
                <span className="ml-auto text-[10px] uppercase tracking-[0.12em] text-muted tabular-nums">
                  {stepIndex + 1} / {STEPS.length}
                </span>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-border">
              <button
                type="button"
                onClick={dismiss}
                className="text-[10px] uppercase tracking-[0.12em] font-medium text-muted hover:text-foreground transition-colors"
              >
                Skip
              </button>

              <div className="flex items-center gap-2">
                {!isFirst ? (
                  <button
                    type="button"
                    onClick={back}
                    className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] font-semibold text-foreground border border-border hover:border-foreground/30 px-3 py-2 transition-colors"
                  >
                    <ArrowLeft size={11} strokeWidth={2} />
                    Back
                  </button>
                ) : null}

                {step.ctaLabel && step.ctaHref ? (
                  <Link
                    href={step.ctaHref}
                    onClick={() => {
                      if (isLast) {
                        void dismiss();
                      } else {
                        next();
                      }
                    }}
                    className="flex items-center gap-1.5 bg-violet text-white text-[11px] uppercase tracking-[0.12em] font-semibold px-4 py-2 hover:bg-violet/90 transition-colors"
                  >
                    {step.ctaLabel}
                    <ArrowRight size={11} strokeWidth={2} />
                  </Link>
                ) : null}

                {!step.ctaHref ? (
                  isLast ? (
                    <button
                      type="button"
                      onClick={dismiss}
                      className="flex items-center gap-1.5 bg-violet text-white text-[11px] uppercase tracking-[0.12em] font-semibold px-4 py-2 hover:bg-violet/90 transition-colors"
                    >
                      <Check size={11} strokeWidth={2.25} />
                      Done
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={next}
                      className="flex items-center gap-1.5 bg-violet text-white text-[11px] uppercase tracking-[0.12em] font-semibold px-4 py-2 hover:bg-violet/90 transition-colors"
                    >
                      Next
                      <ArrowRight size={11} strokeWidth={2} />
                    </button>
                  )
                ) : null}
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
