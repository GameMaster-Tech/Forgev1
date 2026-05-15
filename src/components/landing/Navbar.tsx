"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { Menu, X, ArrowUpRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import ThemeToggle from "@/components/ThemeToggle";

const ease = [0.22, 0.61, 0.36, 1] as const;

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <motion.nav
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease }}
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-white/90 dark:bg-black/90 backdrop-blur-xl border-b border-border"
          : "bg-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo mark */}
        <Link href="/" className="flex items-center gap-3 group">
          <div className="relative w-8 h-8 bg-violet flex items-center justify-center overflow-hidden">
            <span className="font-display font-black text-white text-sm leading-none">F</span>
            <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-cyan" />
          </div>
          <span className="font-display font-bold text-lg tracking-tight text-black dark:text-foreground">
            FORGE
          </span>
        </Link>

        {/* Desktop nav — center */}
        <div className="hidden md:flex items-center gap-1">
          {[
            { label: "Features", href: "#features" },
            { label: "How it works", href: "#how-it-works" },
            { label: "Pricing", href: "#pricing" },
          ].map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="relative text-sm text-gray hover:text-black dark:hover:text-foreground transition-colors duration-200 px-4 py-2 group"
            >
              {link.label}
              <span className="absolute bottom-1 left-4 right-4 h-[1px] bg-violet scale-x-0 group-hover:scale-x-100 transition-transform duration-200 origin-left" />
            </a>
          ))}
        </div>

        {/* Right side */}
        <div className="hidden md:flex items-center gap-2">
          <ThemeToggle />
          <Link
            href="/auth/login"
            className="text-sm text-gray hover:text-black dark:hover:text-foreground transition-colors duration-200 px-4 py-2"
          >
            Log in
          </Link>
          <Link
            href="/auth/signup"
            className="group relative flex items-center gap-2 text-sm bg-black dark:bg-white text-white dark:text-black px-5 py-2.5 font-semibold overflow-hidden"
          >
            <span className="relative z-10">Get Started</span>
            <ArrowUpRight size={14} className="relative z-10 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform duration-200" />
            <div className="absolute inset-0 bg-violet translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)]" />
          </Link>
        </div>

        {/* Mobile toggle */}
        <button
          className="md:hidden text-muted p-1"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease }}
            className="md:hidden bg-white dark:bg-surface border-t border-border overflow-hidden"
          >
            <div className="px-6 py-6 space-y-1">
              {["Features", "How it works", "Pricing"].map((label, i) => (
                <motion.a
                  key={label}
                  href={`#${label.toLowerCase().replace(/ /g, "-")}`}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2, delay: 0.05 * i, ease }}
                  className="block text-lg font-display font-semibold text-black dark:text-foreground py-2"
                  onClick={() => setMobileOpen(false)}
                >
                  {label}
                </motion.a>
              ))}
              <div className="h-px bg-border my-4" />
              <div className="flex items-center justify-between">
                <Link
                  href="/auth/login"
                  className="text-sm text-gray"
                  onClick={() => setMobileOpen(false)}
                >
                  Log in
                </Link>
                <ThemeToggle />
              </div>
              <Link
                href="/auth/signup"
                className="block text-sm bg-black dark:bg-white text-white dark:text-black px-4 py-3 text-center font-semibold mt-3"
                onClick={() => setMobileOpen(false)}
              >
                Get Started Free
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  );
}
