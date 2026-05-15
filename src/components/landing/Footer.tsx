"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight } from "lucide-react";

export default function Footer() {
  const [email, setEmail] = useState("");

  return (
    <footer className="border-t border-border bg-background">
      <div className="max-w-7xl mx-auto px-6">
        {/* Main footer */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-12 py-16">
          {/* Brand column */}
          <div className="lg:col-span-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 bg-violet flex items-center justify-center">
                <span className="font-display font-black text-white text-sm leading-none">F</span>
              </div>
              <span className="font-display font-bold text-lg text-black dark:text-foreground tracking-tight">
                FORGE
              </span>
            </div>
            <p className="text-sm text-gray leading-relaxed max-w-xs mb-6">
              The AI research workspace. Search, write, and verify — with every citation DOI-verified.
            </p>

            {/* Newsletter */}
            <div className="flex">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Your email"
                className="flex-1 bg-surface-light dark:bg-surface border border-border border-r-0 text-sm text-black dark:text-foreground px-4 py-2.5 focus:border-violet focus:outline-none transition-colors placeholder:text-muted min-w-0"
              />
              <button className="bg-violet text-white px-4 py-2.5 flex items-center justify-center hover:bg-violet/90 transition-colors shrink-0">
                <ArrowRight size={16} />
              </button>
            </div>
            <p className="text-[10px] text-muted mt-2">Get product updates. No spam.</p>
          </div>

          {/* Links */}
          <div className="lg:col-span-2 lg:col-start-6">
            <h4 className="text-[10px] font-semibold text-muted uppercase tracking-[0.15em] mb-4">
              Product
            </h4>
            <div className="space-y-3">
              <a href="#features" className="block text-sm text-gray hover:text-black dark:hover:text-foreground transition-colors">
                Features
              </a>
              <a href="#how-it-works" className="block text-sm text-gray hover:text-black dark:hover:text-foreground transition-colors">
                How it works
              </a>
              <a href="#pricing" className="block text-sm text-gray hover:text-black dark:hover:text-foreground transition-colors">
                Pricing
              </a>
            </div>
          </div>

          <div className="lg:col-span-2">
            <h4 className="text-[10px] font-semibold text-muted uppercase tracking-[0.15em] mb-4">
              Account
            </h4>
            <div className="space-y-3">
              <Link href="/auth/login" className="block text-sm text-gray hover:text-black dark:hover:text-foreground transition-colors">
                Log in
              </Link>
              <Link href="/auth/signup" className="block text-sm text-gray hover:text-black dark:hover:text-foreground transition-colors">
                Sign up
              </Link>
              <Link href="/research" className="block text-sm text-gray hover:text-black dark:hover:text-foreground transition-colors">
                Dashboard
              </Link>
            </div>
          </div>

          <div className="lg:col-span-2">
            <h4 className="text-[10px] font-semibold text-muted uppercase tracking-[0.15em] mb-4">
              Connect
            </h4>
            <div className="space-y-3">
              <a href="mailto:research@forgeresearch.ai" className="block text-sm text-gray hover:text-violet transition-colors">
                Email us
              </a>
              <a href="#" className="block text-sm text-gray hover:text-black dark:hover:text-foreground transition-colors">
                Twitter / X
              </a>
              <a href="#" className="block text-sm text-gray hover:text-black dark:hover:text-foreground transition-colors">
                LinkedIn
              </a>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-border py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="text-[11px] text-muted">
            &copy; 2026 Forge Research Inc.
          </span>
          <div className="flex items-center gap-6">
            <a href="#" className="text-[11px] text-muted hover:text-gray transition-colors">
              Privacy
            </a>
            <a href="#" className="text-[11px] text-muted hover:text-gray transition-colors">
              Terms
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
