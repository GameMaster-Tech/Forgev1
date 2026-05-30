"use client";

/**
 * AriaIcon — Forge's voice agent mark. A core presence dot with concentric
 * "voice" arcs radiating out. Uses `currentColor`, so set it to var(--voice)
 * for Aria's signature amber. `active` animates the outer arcs as a soft pulse.
 */

import { motion } from "framer-motion";

export function AriaIcon({
  size = 18,
  active = false,
  className = "",
}: {
  size?: number;
  active?: boolean;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
    >
      {/* Core presence */}
      <circle cx="12" cy="12" r="2.6" fill="currentColor" />
      {/* Inner arcs */}
      <path d="M7.8 8.4a6.2 6.2 0 0 0 0 7.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" opacity="0.9" />
      <path d="M16.2 8.4a6.2 6.2 0 0 1 0 7.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" opacity="0.9" />
      {/* Outer arcs (pulse when active) */}
      <motion.path
        d="M5 6a9.6 9.6 0 0 0 0 12"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
        animate={active ? { opacity: [0.25, 0.6, 0.25] } : { opacity: 0.42 }}
        transition={active ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
      />
      <motion.path
        d="M19 6a9.6 9.6 0 0 1 0 12"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
        animate={active ? { opacity: [0.25, 0.6, 0.25] } : { opacity: 0.42 }}
        transition={active ? { duration: 1.6, repeat: Infinity, ease: "easeInOut", delay: 0.15 } : { duration: 0.2 }}
      />
    </svg>
  );
}
