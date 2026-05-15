"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, ArrowRight, AlertCircle, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { signUp, signInWithGoogle } from "@/lib/firebase/auth";

const ease = [0.22, 0.61, 0.36, 1] as const;

const disciplines = [
  "Graduate Student",
  "Postdoctoral Researcher",
  "Consultant",
  "Analyst",
  "Journalist",
  "Policy Researcher",
  "Legal Professional",
  "Medical Professional",
  "Independent Scholar",
  "Other",
];

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [discipline, setDiscipline] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showDisciplines, setShowDisciplines] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await signUp(email, password, name, discipline);
      router.push("/research");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Sign up failed";
      if (message.includes("email-already-in-use")) {
        setError("An account with this email already exists.");
      } else if (message.includes("weak-password")) {
        setError("Password must be at least 6 characters.");
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError("");
    try {
      await signInWithGoogle();
      router.push("/research");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "";
      if (!message.includes("popup-closed")) {
        setError("Google sign-in failed. Please try again.");
      }
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease }}
    >
      <div className="mb-8">
        <h1 className="font-display font-bold text-2xl text-black dark:text-foreground mb-2">
          Create your account
        </h1>
        <p className="text-sm text-gray">
          Start researching with verified citations
        </p>
      </div>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease }}
            className="mb-6 p-3 bg-red/8 border border-red/15 flex items-start gap-2.5"
          >
            <AlertCircle size={14} className="text-red shrink-0 mt-0.5" />
            <span className="text-xs text-red">{error}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Google OAuth */}
      <button
        type="button"
        onClick={handleGoogle}
        className="w-full border border-border bg-white dark:bg-surface text-black dark:text-foreground py-3.5 flex items-center justify-center gap-3 hover:bg-surface-light dark:hover:bg-surface-light transition-colors duration-200 mb-6 font-medium text-sm"
      >
        <svg width="18" height="18" viewBox="0 0 24 24">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
        </svg>
        Continue with Google
      </button>

      <div className="flex items-center gap-4 mb-6">
        <div className="h-px flex-1 bg-border" />
        <span className="text-[10px] text-muted uppercase tracking-wider">or</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Name + Email row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="name" className="block text-[11px] text-muted uppercase tracking-wider mb-2 font-medium">
              Full name
            </label>
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-white dark:bg-surface border border-border text-black dark:text-foreground px-4 py-3 text-sm focus:border-violet focus:outline-none transition-colors duration-200 placeholder:text-muted"
              placeholder="Your name"
            />
          </div>
          <div>
            <label htmlFor="email" className="block text-[11px] text-muted uppercase tracking-wider mb-2 font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-white dark:bg-surface border border-border text-black dark:text-foreground px-4 py-3 text-sm focus:border-violet focus:outline-none transition-colors duration-200 placeholder:text-muted"
              placeholder="you@example.com"
            />
          </div>
        </div>

        <div>
          <label htmlFor="password" className="block text-[11px] text-muted uppercase tracking-wider mb-2 font-medium">
            Password
          </label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-white dark:bg-surface border border-border text-black dark:text-foreground px-4 py-3 pr-11 text-sm focus:border-violet focus:outline-none transition-colors duration-200 placeholder:text-muted"
              placeholder="At least 8 characters"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-black dark:hover:text-foreground transition-colors"
            >
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        {/* Discipline selector — interactive tiles */}
        <div>
          <label className="block text-[11px] text-muted uppercase tracking-wider mb-2 font-medium">
            Discipline
          </label>
          <button
            type="button"
            onClick={() => setShowDisciplines(!showDisciplines)}
            className={`w-full text-left bg-white dark:bg-surface border text-sm px-4 py-3 transition-colors duration-200 ${
              discipline
                ? "border-violet/30 text-black dark:text-foreground"
                : "border-border text-muted"
            }`}
          >
            {discipline || "Select your discipline"}
          </button>

          <AnimatePresence>
            {showDisciplines && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, ease }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-2 gap-1.5 mt-2">
                  {disciplines.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => {
                        setDiscipline(d);
                        setShowDisciplines(false);
                      }}
                      className={`text-left text-[12px] px-3 py-2.5 border transition-all duration-150 flex items-center justify-between ${
                        discipline === d
                          ? "border-violet/30 bg-violet/5 text-violet font-medium"
                          : "border-border bg-white dark:bg-surface text-gray hover:border-violet/20 hover:text-black dark:hover:text-foreground"
                      }`}
                    >
                      {d}
                      {discipline === d && <Check size={12} className="text-violet" />}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-violet text-white py-3.5 font-semibold text-sm flex items-center justify-center gap-2 hover:bg-violet/90 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed mt-2"
        >
          {loading ? (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              className="w-4 h-4 border-2 border-white/30 border-t-white"
              style={{ borderRadius: 0 }}
            />
          ) : (
            <>
              Create account
              <ArrowRight size={14} />
            </>
          )}
        </button>
      </form>

      <p className="mt-8 text-center text-sm text-gray">
        Already have an account?{" "}
        <Link href="/auth/login" className="text-violet font-medium hover:text-violet/80 transition-colors">
          Log in
        </Link>
      </p>
    </motion.div>
  );
}
