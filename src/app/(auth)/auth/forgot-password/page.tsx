"use client";

import Link from "next/link";
import { useState } from "react";
import { resetPassword } from "@/lib/firebase/auth";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await resetPassword(email);
      setSent(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "";
      if (message.includes("user-not-found")) {
        // Don't reveal whether email exists — still show success
        setSent(true);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border border-border bg-white dark:bg-surface shadow-xl p-8">
      <h1 className="font-display font-bold text-2xl text-black dark:text-foreground mb-2 text-center">
        Reset your password
      </h1>
      <p className="text-sm text-gray text-center mb-8">
        Enter your email and we&apos;ll send you a reset link.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red/10 border border-red/20 text-red text-xs">
          {error}
        </div>
      )}

      {sent ? (
        <div className="text-center">
          <div className="w-12 h-12 flex items-center justify-center mx-auto mb-4">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-cyan"
            >
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <p className="text-sm text-gray mb-6">
            If an account exists for <span className="text-black dark:text-foreground font-medium">{email}</span>, you&apos;ll receive a password reset link shortly.
          </p>
          <Link
            href="/auth/login"
            className="text-sm text-cyan hover:text-cyan/80 transition-colors duration-200"
          >
            Back to login
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-xs text-gray mb-2">Email</label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-white dark:bg-surface border border-border text-black dark:text-foreground px-4 py-3 text-sm focus:border-cyan focus:outline-none transition-colors duration-200 placeholder:text-muted"
              placeholder="you@example.com"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-cyan to-cyan/80 text-white py-3 font-semibold hover:from-cyan/90 hover:to-cyan/70 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_2px_12px_rgba(14,165,233,0.2)]"
          >
            {loading ? "Sending..." : "Send reset link"}
          </button>
        </form>
      )}

      {!sent && (
        <p className="mt-6 text-center text-sm text-gray">
          Remember your password?{" "}
          <Link href="/auth/login" className="text-cyan hover:text-cyan/80 transition-colors duration-200">
            Log in
          </Link>
        </p>
      )}
    </div>
  );
}
