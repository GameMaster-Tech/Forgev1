"use client";

/**
 * CTASection — closing call, mirroring the hero's dark voice stage so the page
 * bookends on the same note: amber glow, one clear action.
 */

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Mic } from "lucide-react";

const ease = [0.22, 0.61, 0.36, 1] as const;

export default function CTASection() {
  return (
    <section className="relative py-28 overflow-hidden" style={{ background: "#0A0812", color: "#F4F1EA" }}>
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: "radial-gradient(80% 120% at 50% 0%, rgba(226,180,102,0.16), transparent 60%)" }}
      />
      <motion.div
        initial={{ opacity: 0, y: 22 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.6, ease }}
        className="relative max-w-3xl mx-auto px-6 text-center"
      >
        <span className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: "#E2B466" }}>
          Forge — the AI-voice-native workspace
        </span>
        <h2 className="mt-6 font-display font-black text-[clamp(2.2rem,5.5vw,4rem)] leading-[1.02] tracking-[-0.035em]">
          Stop clicking.
          <br />
          <span style={{ fontStyle: "italic", fontWeight: 500, color: "#E2B466", fontFamily: "Georgia, 'Times New Roman', serif" }}>
            Start saying.
          </span>
        </h2>
        <p className="mt-6 text-[1.05rem] leading-relaxed mx-auto max-w-md" style={{ color: "rgba(244,241,234,0.6)" }}>
          Your workspace, driven by your voice. Set it up in seconds — Aria takes it from there.
        </p>
        <div className="mt-9 flex items-center justify-center gap-3.5">
          <Link
            href="/auth/signup"
            className="group inline-flex items-center gap-2.5 rounded-[0.5rem] px-7 py-3.5 text-[15px] font-semibold transition-transform active:scale-[0.98]"
            style={{ background: "#E2B466", color: "#0A0812", boxShadow: "0 14px 40px -12px rgba(226,180,102,0.6)" }}
          >
            <Mic size={16} strokeWidth={2.5} />
            Get started — free
            <ArrowRight size={15} className="group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>
      </motion.div>
    </section>
  );
}
