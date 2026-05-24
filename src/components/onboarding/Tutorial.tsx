"use client";

/**
 * First-run interactive tutorial.
 *
 * Mounts inside AppShell. Two-gate "new user" check:
 *
 *   1. Read `users/{uid}.tutorialCompleted` — if truthy, never open.
 *   2. Read Firebase Auth's `metadata.creationTime` — if the account
 *      is older than NEW_USER_GRACE_MS (7 days) AND we have no record
 *      that they finished it, we still don't auto-open (a returning
 *      user who never finished isn't a fresh first-run). Returning
 *      users can always trigger it manually via `replayTutorial()`.
 *
 * On the first real first-run we ALSO mark `users/{uid}.firstSeenAt`
 * so the gate is stable across devices — local-storage is only a
 * within-session hint to suppress flicker.
 *
 * Steps cover the surface area a first-time user needs to feel
 * productive in five minutes: Projects → Docs → Checks → Freshness →
 * Schedule → Rules → Preview → Chat → Cmd-K.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
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
  Clock,
  MessageSquare,
  Command,
  Check,
  Layers,
  Compass,
} from "lucide-react";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase/config";

const EASE = [0.22, 0.61, 0.36, 1] as const;
const STORAGE_KEY = "forge.tutorial.dismissed.v2";
const NEW_USER_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

interface Step {
  icon: typeof Sparkles;
  accent: "violet" | "cyan" | "warm" | "rose" | "green";
  eyebrow: string;
  title: string;
  body: string;
  bullets?: string[];
  ctaLabel?: string;
  ctaHref?: string;
}

const STEPS: Step[] = [
  {
    icon: Compass,
    accent: "violet",
    eyebrow: "Welcome",
    title: "Forge in 90 seconds.",
    body: "Forge is a research workspace built around one principle: the things you write should agree with each other. Let's walk through the parts you'll touch every day.",
    bullets: [
      "Write docs, keep numbers + claims consistent",
      "Plan your week around your real energy",
      "Ask an assistant that has read your whole project",
    ],
  },
  {
    icon: FileText,
    accent: "violet",
    eyebrow: "Step 1 · Projects",
    title: "Everything lives in a project.",
    body: "Docs, sources, schedules, and rules all sit under a project. Spin one up for whatever you're working on — a paper, a launch, a deal — and Forge keeps every signal scoped to it.",
    ctaLabel: "Open projects",
    ctaHref: "/projects",
  },
  {
    icon: Layers,
    accent: "violet",
    eyebrow: "Step 2 · Documents",
    title: "Write like Notion. Think like a compiler.",
    body: "The editor handles long-form writing, tables, embeds, sub-pages, comments, and slash commands. Anything you write is also food for the checks below.",
  },
  {
    icon: GitBranch,
    accent: "rose",
    eyebrow: "Step 3 · Checks",
    title: "Catch contradicting claims.",
    body: "Hit \"Check now\" on the Checks page. The model reads every doc in the project and surfaces statement pairs that disagree — with verbatim quotes and a link straight to the spot to fix.",
    ctaLabel: "Open Checks",
    ctaHref: "/sync",
  },
  {
    icon: Clock,
    accent: "cyan",
    eyebrow: "Step 4 · Freshness",
    title: "Flag claims that aged out.",
    body: "Freshness scans your project for time-sensitive statements — dated milestones, current pricing, headcount, version pins — so the things most likely to drift never go unnoticed.",
    ctaLabel: "Open Freshness",
    ctaHref: "/pulse",
  },
  {
    icon: CalendarIcon,
    accent: "warm",
    eyebrow: "Step 5 · Schedule",
    title: "Plan around your energy.",
    body: "Connect Google Calendar, drop in tasks, habits, and goals. Tempo arranges your week around your focus windows — and Forge explains why each block landed where it did.",
    ctaLabel: "Open Calendar",
    ctaHref: "/calendar",
  },
  {
    icon: ShieldCheck,
    accent: "green",
    eyebrow: "Step 6 · Rules",
    title: "Set guardrails the system enforces.",
    body: "Add rules like \"4 hours of deep work each day\" or \"never schedule meetings on Fridays.\" Tempo respects them; any change that would break a rule is blocked at the source.",
    ctaLabel: "Build rules",
    ctaHref: "/calendar/compiler/invariants",
  },
  {
    icon: Sparkles,
    accent: "violet",
    eyebrow: "Step 7 · Preview",
    title: "See the impact before you commit.",
    body: "Stage a change — a new headcount, a different deadline — and Preview shows you everything downstream that moves, breaks, or stays put. No surprises after you save.",
    ctaLabel: "Open Preview",
    ctaHref: "/preview",
  },
  {
    icon: MessageSquare,
    accent: "cyan",
    eyebrow: "Step 8 · Chat",
    title: "Ask the assistant.",
    body: "Open Research and ask anything about your project. The chat has the full context of your docs, your schedule, and your rules — it answers in your tone, not boilerplate.",
    ctaLabel: "Open Chat",
    ctaHref: "/research",
  },
  {
    icon: Command,
    accent: "violet",
    eyebrow: "Pro tip",
    title: "Cmd-K opens everything.",
    body: "Anywhere in Forge, hit ⌘K to jump to a doc, switch projects, or fire a command. The fastest way to live in the app once it's familiar.",
  },
];

/* ───────────── manual-start hook (Settings → "Replay tour", Help
 *              → "Show tutorial"). Uses a window CustomEvent so any
 *              component anywhere in the tree can trigger it without
 *              the provider being its ancestor.
 * ───────────── */

const REPLAY_EVENT = "forge:tutorial:replay";

export function replayTutorial(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(REPLAY_EVENT));
  }
}

const ACCENT_CLASS: Record<Step["accent"], { bar: string; pill: string; text: string; ring: string; cta: string }> = {
  violet: {
    bar: "bg-violet",
    pill: "text-violet",
    text: "text-violet",
    ring: "border-violet/30 bg-violet/[0.06]",
    cta: "bg-violet hover:bg-violet/90",
  },
  cyan: {
    bar: "bg-cyan",
    pill: "text-cyan",
    text: "text-cyan",
    ring: "border-cyan/30 bg-cyan/[0.06]",
    cta: "bg-cyan hover:bg-cyan/90",
  },
  warm: {
    bar: "bg-warm",
    pill: "text-warm",
    text: "text-warm",
    ring: "border-warm/30 bg-warm/[0.06]",
    cta: "bg-warm hover:bg-warm/90",
  },
  rose: {
    bar: "bg-rose",
    pill: "text-rose",
    text: "text-rose",
    ring: "border-rose/30 bg-rose/[0.06]",
    cta: "bg-rose hover:bg-rose/90",
  },
  green: {
    bar: "bg-green",
    pill: "text-green",
    text: "text-green",
    ring: "border-green/30 bg-green/[0.06]",
    cta: "bg-green hover:bg-green/90",
  },
};

export function Tutorial() {
  const { user, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  // Replay listener — fires when any component calls `replayTutorial()`.
  useEffect(() => {
    const handler = () => {
      setStepIndex(0);
      setOpen(true);
    };
    window.addEventListener(REPLAY_EVENT, handler);
    return () => window.removeEventListener(REPLAY_EVENT, handler);
  }, []);

  // Gate the auto-open on first run only — see file header.
  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (cancelled) return;
        const data = snap.data() as
          | { tutorialCompleted?: boolean; firstSeenAt?: { toMillis?: () => number } }
          | undefined;

        // Hard stop — explicit completion always wins.
        if (data?.tutorialCompleted === true) return;

        // Session-level hint: if this device just dismissed it, don't
        // pop again on the next route change.
        const localDismissed =
          typeof window !== "undefined" &&
          window.sessionStorage.getItem(STORAGE_KEY) === "1";
        if (localDismissed) return;

        // Determine "is this a new user?":
        //   • If we've never seen this uid (no users/{uid} doc), yes.
        //   • If we have a doc but no tutorialCompleted, fall back to
        //     Auth metadata: was the account created in the last 7 days?
        const creationStr = user.metadata?.creationTime;
        const creationMs = creationStr ? Date.parse(creationStr) : NaN;
        const isFreshAccount =
          Number.isFinite(creationMs) && Date.now() - creationMs <= NEW_USER_GRACE_MS;
        const hasDoc = !!data;

        if (!hasDoc || isFreshAccount) {
          // Stamp firstSeenAt so the cross-device gate is sticky.
          try {
            await setDoc(
              doc(db, "users", user.uid),
              { firstSeenAt: serverTimestamp() },
              { merge: true },
            );
          } catch {
            /* best effort */
          }
          setOpen(true);
        }
      } catch {
        // Firestore unreachable — defer to session storage only. Better
        // to show once than not at all for a brand-new user.
        const localDismissed =
          typeof window !== "undefined" &&
          window.sessionStorage.getItem(STORAGE_KEY) === "1";
        if (!localDismissed) setOpen(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  const dismiss = useCallback(async () => {
    setOpen(false);
    setStepIndex(0);
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(STORAGE_KEY, "1");
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
      /* session storage already set */
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
  const accent = ACCENT_CLASS[step.accent];

  return (
    <>
      <AnimatePresence>
        {open ? (
          <motion.div
            key="tutorial-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[80] bg-foreground/35 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div
              key={`tutorial-card-${stepIndex}`}
              initial={{ opacity: 0, y: 10, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.985 }}
              transition={{ duration: 0.26, ease: EASE }}
              className="relative w-full max-w-xl bg-surface border border-border shadow-[0_28px_64px_-24px_rgba(0,0,0,0.4)] overflow-hidden"
            >
              <span
                aria-hidden
                className={`absolute left-0 top-7 bottom-7 w-[2px] ${accent.bar}`}
              />
              {/* Floating accent shape */}
              <motion.div
                aria-hidden
                className="absolute top-5 right-12 pointer-events-none"
                initial={{ opacity: 0, rotate: 0 }}
                animate={{ opacity: 0.18, rotate: 45 }}
                transition={{ duration: 0.5, ease: EASE }}
              >
                <div
                  className={`w-7 h-7 border-[1.5px] ${accent.text.replace("text-", "border-")}`}
                />
              </motion.div>

              <button
                type="button"
                onClick={dismiss}
                aria-label="Skip tutorial"
                className="absolute top-3 right-3 text-muted hover:text-foreground transition-colors p-1.5 z-10"
              >
                <X size={14} strokeWidth={1.75} />
              </button>

              <div className="px-7 pt-8 pb-5 relative">
                <div className="flex items-center gap-3 mb-4">
                  <motion.div
                    initial={{ scale: 0.85, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.32, ease: EASE }}
                    className={`w-10 h-10 border ${accent.ring} flex items-center justify-center`}
                  >
                    <step.icon size={16} strokeWidth={2} className={accent.text} />
                  </motion.div>
                  <span
                    className={`text-[10px] uppercase tracking-[0.18em] font-semibold ${accent.pill}`}
                  >
                    {step.eyebrow}
                  </span>
                </div>
                <motion.h2
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28, ease: EASE }}
                  className="font-display font-bold text-foreground text-[26px] tracking-[-0.022em] leading-[1.1] mb-3"
                >
                  {step.title}
                </motion.h2>
                <motion.p
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.04, ease: EASE }}
                  className="text-[13.5px] text-muted leading-relaxed"
                >
                  {step.body}
                </motion.p>
                {step.bullets && step.bullets.length > 0 ? (
                  <ul className="mt-4 space-y-2">
                    {step.bullets.map((b, i) => (
                      <motion.li
                        key={b}
                        initial={{ opacity: 0, x: -4 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.22, delay: 0.08 + i * 0.05, ease: EASE }}
                        className="flex items-start gap-2.5 text-[12.5px] text-foreground/85"
                      >
                        <Check size={11} strokeWidth={2.5} className={`${accent.text} mt-1`} />
                        {b}
                      </motion.li>
                    ))}
                  </ul>
                ) : null}
              </div>

              {/* Progress dots */}
              <div className="px-7 pb-4">
                <div className="flex items-center gap-1.5">
                  {STEPS.map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setStepIndex(i)}
                      aria-label={`Go to step ${i + 1}`}
                      className={`h-1 transition-all ${
                        i === stepIndex
                          ? `w-8 ${accent.bar}`
                          : i < stepIndex
                            ? `w-4 ${accent.bar} opacity-40`
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
              <div className="flex items-center justify-between gap-2 px-7 py-4 border-t border-border bg-background/40">
                <button
                  type="button"
                  onClick={dismiss}
                  className="text-[10px] uppercase tracking-[0.12em] font-medium text-muted hover:text-foreground transition-colors"
                >
                  Skip tour
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
                      className={`flex items-center gap-1.5 ${accent.cta} text-white text-[11px] uppercase tracking-[0.12em] font-semibold px-4 py-2 transition-colors`}
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
                        className={`flex items-center gap-1.5 ${accent.cta} text-white text-[11px] uppercase tracking-[0.12em] font-semibold px-4 py-2 transition-colors`}
                      >
                        <Check size={11} strokeWidth={2.25} />
                        I&apos;m ready
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={next}
                        className={`flex items-center gap-1.5 ${accent.cta} text-white text-[11px] uppercase tracking-[0.12em] font-semibold px-4 py-2 transition-colors`}
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
    </>
  );
}
