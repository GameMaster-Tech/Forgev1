"use client";

import { useRef } from "react";
import Link from "next/link";
import { motion, useInView } from "framer-motion";
import { ArrowRight } from "lucide-react";

const ease = [0.22, 0.61, 0.36, 1] as const;

export default function CTASection() {
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: true, margin: "-60px" });

  return (
    <section
      ref={sectionRef}
      className="relative py-32 sm:py-40 bg-black dark:bg-surface overflow-hidden"
    >
      {/* Animated grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(var(--violet) 1px, transparent 1px), linear-gradient(90deg, var(--violet) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      {/* Gradient wash */}
      <div className="absolute top-0 left-0 w-full h-full">
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-violet/[0.12] blur-[150px] pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/3 w-[400px] h-[400px] bg-cyan/[0.08] blur-[130px] pointer-events-none" />
      </div>

      <div className="relative max-w-4xl mx-auto px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, ease }}
        >
          {/* Social proof */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.4, ease, delay: 0.1 }}
            className="flex items-center justify-center gap-3 mb-10"
          >
            {/* Stacked avatars */}
            <div className="flex -space-x-2">
              {[
                "bg-violet",
                "bg-cyan",
                "bg-warm",
                "bg-green",
              ].map((color, i) => (
                <div
                  key={i}
                  className={`w-7 h-7 ${color} border-2 border-black dark:border-surface flex items-center justify-center`}
                >
                  <span className="text-[8px] font-bold text-white">
                    {["RK", "JD", "AL", "MS"][i]}
                  </span>
                </div>
              ))}
            </div>
            <span className="text-sm text-white/50 dark:text-muted">
              Join 2,000+ researchers
            </span>
          </motion.div>

          {/* Headline */}
          <h2 className="font-display font-extrabold text-5xl sm:text-6xl lg:text-7xl text-white dark:text-foreground leading-[1.05] tracking-[-0.03em] mb-8">
            Where research
            <br />
            <span className="bg-gradient-to-r from-violet-light via-cyan to-violet-light bg-clip-text text-transparent bg-[length:200%_auto] animate-gradient">
              begins.
            </span>
          </h2>

          <p className="text-lg text-white/40 dark:text-muted max-w-lg mx-auto leading-relaxed mb-12">
            The tools researchers use today were built for a different era.
            Forge is built for what&apos;s possible now.
          </p>

          {/* CTA */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/auth/signup"
              className="group relative flex items-center gap-3 bg-violet text-white px-10 py-5 text-lg font-semibold overflow-hidden btn-glow-violet"
            >
              <span className="relative z-10">Get started free</span>
              <ArrowRight
                size={18}
                className="relative z-10 group-hover:translate-x-1 transition-transform duration-200"
              />
            </Link>
          </div>

          {/* Fine print */}
          <p className="text-xs text-white/25 dark:text-muted/50 mt-6">
            14-day free trial. No credit card required. Cancel anytime.
          </p>
        </motion.div>
      </div>
    </section>
  );
}
