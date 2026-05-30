"use client";

/**
 * Hero — a living, centered voice-native stage.
 *
 * Drifting aurora (amber + indigo + cyan blobs), a mouse-reactive glow, a
 * self-cycling "voice bar" that types real Aria commands with a live waveform
 * and a result flash, and capability chips that float in orbit. Everything is
 * transform/opacity-only, so it stays smooth.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Mic, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const ease = [0.22, 0.61, 0.36, 1] as const;

const COMMANDS = [
  { say: "Open my calendar", done: "Calendar" },
  { say: "Draft a brief on Q3 pricing", done: "Document created" },
  { say: "Schedule a focus block at 9am", done: "Event added" },
  { say: "Summarize this page for me", done: "Summarized" },
  { say: "Set up my workspace", done: "Workspace ready" },
];

const CHIPS = ["Navigate", "Write", "Research", "Schedule", "Summarize", "Plan"];

export default function Hero() {
  return (
    <section
      className="relative min-h-screen flex items-center justify-center overflow-hidden"
      style={{ background: "#0A0812", color: "#F4F1EA" }}
    >
      <Aurora />
      {/* dot grid */}
      <div
        className="absolute inset-0 opacity-[0.05] pointer-events-none"
        style={{ backgroundImage: "radial-gradient(circle at 1px 1px, #F4F1EA 0.5px, transparent 0)", backgroundSize: "36px 36px" }}
      />

      <div className="relative z-10 max-w-4xl mx-auto px-6 text-center py-28">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease }}
          className="inline-flex items-center gap-2.5 rounded-full border px-3.5 py-1.5 mb-9"
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
          initial={{ opacity: 0, y: 26 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease, delay: 0.06 }}
          className="font-display font-black leading-[0.95] tracking-[-0.04em] text-[clamp(3rem,8vw,6rem)]"
        >
          Your workspace,
          <br />
          at the speed of{" "}
          <motion.span
            className="bg-clip-text text-transparent"
            style={{ backgroundImage: "linear-gradient(100deg,#E2B466,#F0CF9A,#E2B466)", backgroundSize: "200% auto" }}
            animate={{ backgroundPosition: ["0% center", "200% center"] }}
            transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
          >
            speech
          </motion.span>
          .
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease, delay: 0.16 }}
          className="mt-7 text-[1.1rem] leading-relaxed mx-auto max-w-xl"
          style={{ color: "rgba(244,241,234,0.6)" }}
        >
          Meet <span style={{ color: "#F4F1EA", fontWeight: 600 }}>Aria</span> — your voice in Forge. Say what you
          want; watch her navigate, create, schedule, research, and write it, hands-free.
        </motion.p>

        {/* Live voice bar */}
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, ease, delay: 0.26 }}
          className="mt-10"
        >
          <VoiceBar />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease, delay: 0.36 }}
          className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3.5"
        >
          <Link
            href="/auth/signup"
            className="group inline-flex items-center gap-2.5 rounded-[0.5rem] px-7 py-3.5 text-[15px] font-semibold transition-transform active:scale-[0.98]"
            style={{ background: "#E2B466", color: "#0A0812", boxShadow: "0 14px 44px -10px rgba(226,180,102,0.6)" }}
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

        {/* Floating capability chips */}
        <div className="mt-12 flex flex-wrap items-center justify-center gap-2.5">
          {CHIPS.map((c, i) => (
            <motion.span
              key={c}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: [0, -5, 0] }}
              transition={{
                opacity: { duration: 0.4, delay: 0.5 + i * 0.07 },
                y: { duration: 3 + (i % 3), repeat: Infinity, ease: "easeInOut", delay: i * 0.2 },
              }}
              className="text-[12px] rounded-full px-3.5 py-1.5"
              style={{ border: "1px solid rgba(244,241,234,0.12)", color: "rgba(244,241,234,0.62)", background: "rgba(255,255,255,0.02)" }}
            >
              {c}
            </motion.span>
          ))}
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-28 pointer-events-none" style={{ background: "linear-gradient(to bottom, transparent, #0A0812)" }} />
    </section>
  );
}

/* ───────────────────────── aurora ───────────────────────── */

function Aurora() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <motion.div
        className="absolute rounded-full blur-[120px]"
        style={{ width: 560, height: 560, top: "-10%", right: "2%", background: "rgba(226,180,102,0.22)" }}
        animate={{ x: [0, -40, 20, 0], y: [0, 30, -20, 0], scale: [1, 1.1, 0.95, 1] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute rounded-full blur-[120px]"
        style={{ width: 620, height: 620, bottom: "-15%", left: "0%", background: "rgba(99,102,241,0.2)" }}
        animate={{ x: [0, 50, -20, 0], y: [0, -30, 20, 0], scale: [1, 0.95, 1.1, 1] }}
        transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute rounded-full blur-[140px]"
        style={{ width: 480, height: 480, top: "30%", left: "40%", background: "rgba(34,211,238,0.08)" }}
        animate={{ x: [0, 30, -30, 0], y: [0, 20, -10, 0] }}
        transition={{ duration: 26, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

/* ───────────────────────── voice bar ───────────────────────── */

function VoiceBar() {
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<"typing" | "done">("typing");
  const [n, setN] = useState(0);
  const cmd = COMMANDS[idx];
  const timers = useRef<number[]>([]);

  useEffect(() => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
    setN(0);
    setPhase("typing");
    const text = cmd.say;
    let i = 0;
    const tick = () => {
      i += 1;
      setN(i);
      if (i < text.length) {
        timers.current.push(window.setTimeout(tick, 45));
      } else {
        timers.current.push(window.setTimeout(() => setPhase("done"), 600));
        timers.current.push(
          window.setTimeout(() => setIdx((v) => (v + 1) % COMMANDS.length), 2200),
        );
      }
    };
    timers.current.push(window.setTimeout(tick, 350));
    return () => timers.current.forEach((t) => clearTimeout(t));
  }, [idx, cmd.say]);

  return (
    <div
      className="mx-auto max-w-xl rounded-2xl border px-4 py-3.5 flex items-center gap-3"
      style={{ borderColor: "rgba(244,241,234,0.12)", background: "rgba(255,255,255,0.025)", backdropFilter: "blur(8px)", boxShadow: "0 30px 80px -30px rgba(0,0,0,0.8)" }}
    >
      <span className="relative w-9 h-9 shrink-0 rounded-full flex items-center justify-center" style={{ background: "rgba(226,180,102,0.16)", color: "#E2B466" }}>
        <Mic size={15} strokeWidth={2.5} />
        <motion.span
          className="absolute inset-0 rounded-full"
          style={{ border: "1.5px solid #E2B466" }}
          animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
        />
      </span>

      {/* mini waveform */}
      <div className="flex items-center gap-[2px] h-6">
        {Array.from({ length: 9 }).map((_, i) => (
          <motion.span
            key={i}
            className="w-[2px] rounded-full"
            style={{ background: "#E2B466" }}
            animate={phase === "typing" ? { height: [4, 8 + ((i * 13) % 14), 4] } : { height: 4 }}
            transition={phase === "typing" ? { duration: 0.6 + (i % 4) * 0.1, repeat: Infinity, ease: "easeInOut", delay: i * 0.04 } : { duration: 0.3 }}
          />
        ))}
      </div>

      <div className="flex-1 min-w-0 text-left">
        <span className="text-[14px]" style={{ color: "rgba(244,241,234,0.92)" }}>
          {cmd.say.slice(0, n)}
          {phase === "typing" && (
            <motion.span className="inline-block w-[2px] h-[15px] align-middle ml-[1px]" style={{ background: "#E2B466" }} animate={{ opacity: [1, 0, 1] }} transition={{ duration: 0.8, repeat: Infinity }} />
          )}
        </span>
      </div>

      <AnimatePresence>
        {phase === "done" && (
          <motion.span
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
            style={{ background: "rgba(99,102,241,0.16)", color: "#A5B4FC" }}
          >
            <Check size={11} strokeWidth={3} />
            {cmd.done}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
