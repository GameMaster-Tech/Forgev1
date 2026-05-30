"use client";

/**
 * Hero — voice-native landing centerpiece.
 *
 * A cinematic dark stage (independent of theme) with Forge's signature amber
 * "voice" glow + indigo. The right side runs a looping, illustrative demo of the
 * Aria loop: listening (live waveform) → heard (transcript) → acting (ghost
 * cursor types a doc). No real audio — pure staged motion, à la Notion's hero
 * vignettes.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Mic } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const ease = [0.22, 0.61, 0.36, 1] as const;
const TRANSCRIPT = "Write a brief on AI's impact on jobs in India";
const DRAFT =
  "AI is reshaping India's labor market — automating routine tasks while creating demand for new, higher-skill roles.";

/** 0 listening · 1 heard · 2 acting (typing) — loops forever. */
function usePhase() {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const durations = [2200, 1500, 4200];
    const t = setTimeout(() => setPhase((p) => (p + 1) % 3), durations[phase]);
    return () => clearTimeout(t);
  }, [phase]);
  return phase;
}

export default function Hero() {
  const phase = usePhase();

  return (
    <section
      className="relative min-h-screen flex items-center overflow-hidden"
      style={{ background: "#0A0812", color: "#F4F1EA" }}
    >
      {/* Atmosphere: amber voice glow + indigo, grain, dot grid */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: "radial-gradient(120% 90% at 78% 12%, rgba(226,180,102,0.16), transparent 55%), radial-gradient(90% 80% at 10% 90%, rgba(99,102,241,0.14), transparent 55%)" }}
      />
      <div
        className="absolute inset-0 opacity-[0.06] pointer-events-none"
        style={{ backgroundImage: "radial-gradient(circle at 1px 1px, #F4F1EA 0.5px, transparent 0)", backgroundSize: "34px 34px" }}
      />

      <div className="relative max-w-7xl mx-auto px-6 w-full py-28">
        <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-14 lg:gap-10 items-center">
          {/* ── Left: the pitch ── */}
          <div className="max-w-xl">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease }}
              className="inline-flex items-center gap-2.5 rounded-full border px-3.5 py-1.5 mb-8"
              style={{ borderColor: "rgba(226,180,102,0.35)", background: "rgba(226,180,102,0.07)" }}
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping" style={{ background: "#E2B466" }} />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: "#E2B466" }} />
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: "#E2B466" }}>
                The AI-voice-native workspace
              </span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 28 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease, delay: 0.06 }}
              className="font-display font-black leading-[0.98] tracking-[-0.035em] text-[clamp(2.8rem,6.4vw,5rem)]"
            >
              Just say it.
              <br />
              <span style={{ fontStyle: "italic", fontWeight: 500, color: "#E2B466", fontFamily: "Georgia, 'Times New Roman', serif" }}>
                Forge
              </span>{" "}
              does the rest.
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease, delay: 0.16 }}
              className="mt-7 text-[1.05rem] leading-relaxed max-w-md"
              style={{ color: "rgba(244,241,234,0.62)" }}
            >
              Meet <span style={{ color: "#F4F1EA", fontWeight: 600 }}>Aria</span> — your voice in Forge. Navigate,
              create projects and documents, schedule, and research, all hands-free. You talk; she does it while you watch.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease, delay: 0.24 }}
              className="mt-10 flex flex-col sm:flex-row items-start gap-3.5"
            >
              <Link
                href="/auth/signup"
                className="group inline-flex items-center gap-2.5 rounded-[0.5rem] px-7 py-3.5 text-[15px] font-semibold transition-transform active:scale-[0.98]"
                style={{ background: "#E2B466", color: "#0A0812", boxShadow: "0 14px 40px -12px rgba(226,180,102,0.6)" }}
              >
                <Mic size={16} strokeWidth={2.5} />
                Start with your voice
                <ArrowRight size={15} className="group-hover:translate-x-1 transition-transform" />
              </Link>
              <a
                href="#how-it-works"
                className="inline-flex items-center gap-2 rounded-[0.5rem] px-6 py-3.5 text-[15px] transition-colors"
                style={{ border: "1px solid rgba(244,241,234,0.18)", color: "rgba(244,241,234,0.85)" }}
              >
                See it work
              </a>
            </motion.div>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, ease, delay: 0.36 }}
              className="mt-6 text-[12px]"
              style={{ color: "rgba(244,241,234,0.4)" }}
            >
              Press{" "}
              <kbd className="px-1.5 py-0.5 rounded border text-[11px]" style={{ borderColor: "rgba(244,241,234,0.2)", color: "rgba(244,241,234,0.7)" }}>
                F2
              </kbd>{" "}
              anywhere — no setup, no typing required.
            </motion.p>
          </div>

          {/* ── Right: the looping Aria demo ── */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.7, ease, delay: 0.2 }}
            className="relative"
          >
            <AriaDemo phase={phase} />
          </motion.div>
        </div>
      </div>

      {/* bottom fade into the next (light) section */}
      <div className="absolute bottom-0 left-0 right-0 h-24 pointer-events-none" style={{ background: "linear-gradient(to bottom, transparent, #0A0812)" }} />
    </section>
  );
}

/* ───────────────────────── the demo ───────────────────────── */

function AriaDemo({ phase }: { phase: number }) {
  return (
    <div
      className="relative rounded-2xl border overflow-hidden"
      style={{ borderColor: "rgba(244,241,234,0.1)", background: "rgba(255,255,255,0.02)", boxShadow: "0 40px 90px -30px rgba(0,0,0,0.8)" }}
    >
      {/* window chrome */}
      <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "rgba(244,241,234,0.08)" }}>
        <div className="flex gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: "rgba(244,241,234,0.18)" }} />
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: "rgba(244,241,234,0.18)" }} />
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: "rgba(244,241,234,0.18)" }} />
        </div>
        <div className="flex-1 text-center text-[10px]" style={{ color: "rgba(244,241,234,0.3)" }}>
          forge — AI Impact
        </div>
      </div>

      <div className="p-5 min-h-[340px] flex flex-col">
        {/* Aria status row */}
        <div className="flex items-center gap-2.5 mb-4">
          <span
            className="w-7 h-7 rounded-full flex items-center justify-center"
            style={{ background: "rgba(226,180,102,0.14)", color: "#E2B466" }}
          >
            <Mic size={13} strokeWidth={2.5} />
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: "#E2B466" }}>
            {phase === 0 ? "Aria · listening" : phase === 1 ? "Aria · understood" : "Aria · writing"}
          </span>
        </div>

        {/* Waveform (listening) */}
        <Waveform active={phase === 0} />

        {/* Transcript chip */}
        <AnimatePresence>
          {phase >= 1 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease }}
              className="mt-1 rounded-lg px-3.5 py-2.5 text-[13px]"
              style={{ background: "rgba(244,241,234,0.05)", border: "1px solid rgba(244,241,234,0.1)", color: "rgba(244,241,234,0.9)" }}
            >
              <span style={{ color: "#E2B466" }}>“</span>
              {TRANSCRIPT}
              <span style={{ color: "#E2B466" }}>”</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* The doc being written */}
        <AnimatePresence>
          {phase === 2 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35, ease }}
              className="mt-4 flex-1 rounded-lg p-4"
              style={{ background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.22)" }}
            >
              <div className="text-[10px] uppercase tracking-[0.2em] mb-2" style={{ color: "#818CF8" }}>
                ⁂ AI Impact
              </div>
              <Typewriter text={DRAFT} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Waveform({ active }: { active: boolean }) {
  const bars = 28;
  return (
    <div className="flex items-center justify-center gap-[3px] h-16 mb-2">
      {Array.from({ length: bars }).map((_, i) => (
        <motion.span
          key={i}
          className="w-[3px] rounded-full"
          style={{ background: active ? "#E2B466" : "rgba(244,241,234,0.15)" }}
          animate={
            active
              ? { height: [6, 10 + ((i * 37) % 38), 6] }
              : { height: 5 }
          }
          transition={
            active
              ? { duration: 0.7 + (i % 5) * 0.12, repeat: Infinity, ease: "easeInOut", delay: (i % 7) * 0.05 }
              : { duration: 0.3 }
          }
        />
      ))}
    </div>
  );
}

function Typewriter({ text }: { text: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    const id = setInterval(() => setN((v) => (v >= text.length ? v : v + 1)), 28);
    return () => clearInterval(id);
  }, [text]);
  return (
    <p className="text-[13px] leading-[1.7]" style={{ color: "rgba(244,241,234,0.82)" }}>
      {text.slice(0, n)}
      <motion.span
        aria-hidden
        className="inline-block w-[2px] h-[14px] align-middle ml-[1px]"
        style={{ background: "#E2B466" }}
        animate={{ opacity: [1, 0, 1] }}
        transition={{ duration: 0.9, repeat: Infinity }}
      />
    </p>
  );
}
