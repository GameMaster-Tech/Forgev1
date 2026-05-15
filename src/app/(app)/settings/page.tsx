"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  User,
  Key,
  Bell,
  Shield,
  Save,
  Check,
  ArrowLeft,
  Eye,
  EyeOff,
  Zap,
  Sparkles,
  Crown,
  LogOut,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { updateProfile } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { useAuth } from "@/context/AuthContext";
import { signOut } from "@/lib/firebase/auth";
import { db } from "@/lib/firebase/config";

const ease = [0.22, 0.61, 0.36, 1] as const;

type SettingsTab = "profile" | "api" | "preferences";

const tabs: { id: SettingsTab; label: string; icon: typeof User; color: string }[] = [
  { id: "profile", label: "Profile", icon: User, color: "cyan" },
  { id: "api", label: "API & Integrations", icon: Key, color: "warm" },
  { id: "preferences", label: "Preferences", icon: Bell, color: "green" },
];

interface UserPreferences {
  discipline: string;
  autoVerify: boolean;
  maxResults: string;
  synthesisMode: boolean;
}

const defaultPreferences: UserPreferences = {
  discipline: "Other",
  autoVerify: true,
  maxResults: "3",
  synthesisMode: true,
};

export default function SettingsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [loadingPrefs, setLoadingPrefs] = useState(true);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const [discipline, setDiscipline] = useState(defaultPreferences.discipline);
  const [autoVerify, setAutoVerify] = useState(defaultPreferences.autoVerify);
  const [maxResults, setMaxResults] = useState(defaultPreferences.maxResults);
  const [synthesisMode, setSynthesisMode] = useState(defaultPreferences.synthesisMode);

  const [showExaKey, setShowExaKey] = useState(false);

  useEffect(() => {
    if (user) {
      setName(user.displayName || "");
      setEmail(user.email || "");
    }
  }, [user]);

  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;

    async function loadPreferences() {
      setLoadingPrefs(true);
      try {
        const prefDoc = await getDoc(doc(db, "userPreferences", user!.uid));
        if (!cancelled && prefDoc.exists()) {
          const data = prefDoc.data() as Partial<UserPreferences>;
          if (data.discipline) setDiscipline(data.discipline);
          if (data.autoVerify !== undefined) setAutoVerify(data.autoVerify);
          if (data.maxResults) setMaxResults(data.maxResults);
          if (data.synthesisMode !== undefined) setSynthesisMode(data.synthesisMode);
        }
      } catch (err) {
        console.error("Failed to load preferences:", err);
      } finally {
        if (!cancelled) setLoadingPrefs(false);
      }
    }

    loadPreferences();
    return () => { cancelled = true; };
  }, [user]);

  const handleSave = useCallback(async () => {
    if (!user) return;
    setSaving(true);
    setSaved(false);

    try {
      if (name !== user.displayName) {
        await updateProfile(user, { displayName: name });
      }

      await setDoc(
        doc(db, "userPreferences", user.uid),
        { discipline, autoVerify, maxResults, synthesisMode },
        { merge: true }
      );

      await setDoc(
        doc(db, "users", user.uid),
        { name, discipline },
        { merge: true }
      );

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error("Failed to save settings:", err);
    } finally {
      setSaving(false);
    }
  }, [user, name, discipline, autoVerify, maxResults, synthesisMode]);

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await signOut();
      router.push("/auth/login");
    } catch (err) {
      console.error("Sign out failed:", err);
      setSigningOut(false);
    }
  }, [router]);

  const maskedExaKey = "255a6e......-....-....-............690677";

  return (
    <div className="min-h-screen bg-background overflow-y-auto relative">
      <div className="fixed inset-0 chromatic-bg pointer-events-none" />
      <div
        className="fixed inset-0 opacity-[0.03] dark:opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, var(--foreground) 0.5px, transparent 0)",
          backgroundSize: "32px 32px",
        }}
      />
      {/* Top bar */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease }}
        className="relative z-20 sticky top-0 h-12 flex items-center px-6 shrink-0 gap-4 border-b border-border bg-background/80 backdrop-blur-md"
      >
        <Link
          href="/projects"
          className="text-[11px] uppercase tracking-[0.15em] text-muted hover:text-violet font-bold transition-colors flex items-center gap-2"
        >
          <ArrowLeft size={14} />
          Dashboard
        </Link>
        <div className="h-4 w-px bg-border" />
        <h1 className="text-[11px] uppercase tracking-[0.15em] text-muted font-bold">Settings</h1>
      </motion.div>

      <div className="relative z-10 px-8 py-12">
        {/* Header */}
        <div className="max-w-4xl mx-auto mb-8">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease }}
            className="border border-border bg-white/60 dark:bg-surface/60 backdrop-blur-sm p-8"
          >
            <div className="flex items-center gap-2 mb-3">
              <div className="flex items-center gap-2 bg-warm/10 border border-warm/20 px-3 py-1">
                <Sparkles size={12} className="text-warm" />
                <span className="text-[10px] text-warm font-semibold uppercase tracking-wider">Configuration</span>
              </div>
            </div>
            <h1 className="font-display font-extrabold text-4xl text-black dark:text-foreground mb-1 tracking-[-0.02em] leading-[1.05]">Settings</h1>
            <p className="text-sm text-gray">
              Manage your profile, integrations, and research preferences.
            </p>
          </motion.div>
        </div>

        <div className="max-w-4xl mx-auto">
          <div className="flex flex-col lg:flex-row gap-8">
            {/* Tab navigation */}
            <motion.nav
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, ease, delay: 0.05 }}
              className="w-full lg:w-52 shrink-0 space-y-1"
            >
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm transition-colors duration-200 text-left relative border ${
                      active
                        ? "text-black dark:text-foreground bg-white/70 dark:bg-surface/80 font-semibold border-border"
                        : "text-gray border-transparent hover:text-black dark:hover:text-foreground hover:bg-white/40 dark:hover:bg-surface/50 hover:border-border"
                    }`}
                  >
                    <Icon size={16} className={active ? `text-${tab.color}` : ""} />
                    {tab.label}
                  </button>
                );
              })}
            </motion.nav>

            {/* Content */}
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease }}
              className="flex-1 min-w-0"
            >
              {activeTab === "profile" && (
                <div className="space-y-6">
                  {/* Profile Information */}
                  <div className="border border-border bg-white/70 dark:bg-surface/70 backdrop-blur-sm p-6">
                    <h2 className="text-sm text-black dark:text-foreground font-semibold mb-5 flex items-center gap-2">
                      <div className="w-7 h-7 bg-cyan/10 flex items-center justify-center">
                        <User size={13} className="text-cyan" />
                      </div>
                      Profile Information
                    </h2>

                    {loadingPrefs ? (
                      <div className="flex items-center gap-2 py-8 justify-center">
                        <Loader2 size={16} className="text-cyan animate-spin" />
                        <span className="text-sm text-muted">Loading profile...</span>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div>
                          <label className="text-[11px] text-muted uppercase tracking-wider block mb-1.5">
                            Full Name
                          </label>
                          <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full bg-white dark:bg-surface-light border border-border text-black dark:text-foreground px-4 py-2.5 text-sm focus:border-violet focus:outline-none transition-colors duration-200"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-muted uppercase tracking-wider block mb-1.5">
                            Email
                          </label>
                          <input
                            type="email"
                            value={email}
                            disabled
                            className="w-full bg-surface-light/50 dark:bg-surface-light border border-border text-gray dark:text-muted px-4 py-2.5 text-sm cursor-not-allowed"
                          />
                          <p className="text-[10px] text-muted mt-1">
                            Email is managed by your authentication provider.
                          </p>
                        </div>
                        <div>
                          <label className="text-[11px] text-muted uppercase tracking-wider block mb-1.5">
                            Primary Discipline
                          </label>
                          <select
                            value={discipline}
                            onChange={(e) => setDiscipline(e.target.value)}
                            className="w-full bg-white dark:bg-surface-light border border-border text-black dark:text-foreground px-4 py-2.5 text-sm focus:border-violet focus:outline-none transition-colors duration-200 appearance-none"
                          >
                            {[
                              "Computer Science", "Biology", "Medicine", "Psychology",
                              "Physics", "Chemistry", "Economics", "Sociology",
                              "Law", "Engineering", "Humanities", "Political Science",
                              "Environmental Science", "Other",
                            ].map((d) => (
                              <option key={d} value={d} className="bg-white dark:bg-surface">
                                {d}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Account */}
                  <div className="border border-border bg-white/70 dark:bg-surface/70 backdrop-blur-sm p-6">
                    <h2 className="text-sm text-black dark:text-foreground font-semibold mb-3 flex items-center gap-2">
                      <div className="w-7 h-7 bg-warm/10 flex items-center justify-center">
                        <Shield size={13} className="text-warm" />
                      </div>
                      Account
                    </h2>
                    <p className="text-sm text-gray mb-4">
                      {user?.providerData[0]?.providerId === "google.com"
                        ? "Connected via Google OAuth."
                        : "Signed in with email and password."}
                      {" "}To delete your account, contact support.
                    </p>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] text-warm bg-warm/10 border border-warm/25 px-3 py-1.5 font-semibold uppercase tracking-wider flex items-center gap-1">
                          <Crown size={9} />
                          Free Plan
                        </span>
                        <span className="text-[10px] text-muted">20 queries/day · 3 projects</span>
                      </div>
                    </div>

                    <div className="mt-6 pt-5 border-t border-border">
                      <button
                        onClick={handleSignOut}
                        disabled={signingOut}
                        className="flex items-center gap-2 text-sm font-medium text-red/80 hover:text-red border border-red/20 hover:border-red/40 hover:bg-red/5 px-4 py-2.5 transition-colors duration-200 disabled:opacity-50"
                      >
                        {signingOut ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <LogOut size={14} />
                        )}
                        {signingOut ? "Signing out..." : "Sign out"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "api" && (
                <div className="space-y-6">
                  <div className="border border-border bg-white/70 dark:bg-surface/70 backdrop-blur-sm p-6">
                    <h2 className="text-sm text-black dark:text-foreground font-semibold mb-5 flex items-center gap-2">
                      <div className="w-7 h-7 bg-cyan/10 flex items-center justify-center">
                        <Zap size={13} className="text-cyan" />
                      </div>
                      Exa Search API
                    </h2>
                    <p className="text-xs text-gray mb-4">
                      Forge uses Exa to search 200M+ sources. Your key is stored server-side and never exposed to the browser.
                    </p>
                    <div>
                      <label className="text-[11px] text-muted uppercase tracking-wider block mb-1.5">
                        API Key
                      </label>
                      <div className="relative">
                        <input
                          type={showExaKey ? "text" : "password"}
                          value={maskedExaKey}
                          readOnly
                          className="w-full bg-surface-light/50 dark:bg-surface-light border border-border text-gray dark:text-muted px-4 py-2.5 pr-10 text-sm font-mono cursor-not-allowed"
                        />
                        <button
                          type="button"
                          onClick={() => setShowExaKey(!showExaKey)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-black dark:hover:text-foreground transition-colors duration-200 p-1"
                        >
                          {showExaKey ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                      <p className="text-[10px] text-muted mt-1.5">
                        Server-side key — managed via environment variables.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <div className="w-2 h-2 bg-green" />
                      <span className="text-[10px] text-green font-medium">Connected</span>
                    </div>
                  </div>

                  <div className="border border-border bg-white/70 dark:bg-surface/70 backdrop-blur-sm p-6">
                    <h2 className="text-sm text-black dark:text-foreground font-semibold mb-5 flex items-center gap-2">
                      <div className="w-7 h-7 bg-green/10 flex items-center justify-center">
                        <Shield size={13} className="text-green" />
                      </div>
                      Crossref Verification
                    </h2>
                    <p className="text-xs text-gray mb-4">
                      Automatic DOI verification against 150M+ Crossref records. No API key required — uses the public polite API.
                    </p>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-green" />
                      <span className="text-[10px] text-green font-medium">Active — public API (polite pool)</span>
                    </div>
                  </div>

                  <div className="border border-border bg-white/70 dark:bg-surface/70 backdrop-blur-sm p-6">
                    <h2 className="text-sm text-black dark:text-foreground font-semibold mb-5 flex items-center gap-2">
                      <div className="w-7 h-7 bg-rose/10 flex items-center justify-center">
                        <Sparkles size={13} className="text-rose" />
                      </div>
                      AI Writing Assistant
                    </h2>
                    <p className="text-xs text-gray mb-4">
                      Powered by Claude. Handles writing commands: continue, summarize, expand, simplify, fix grammar, and tone adjustments.
                    </p>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-cyan" />
                      <span className="text-[10px] text-cyan font-medium">Server-side — managed via environment</span>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "preferences" && (
                <div className="space-y-6">
                  {loadingPrefs ? (
                    <div className="flex items-center gap-2 py-16 justify-center">
                      <Loader2 size={16} className="text-cyan animate-spin" />
                      <span className="text-sm text-muted">Loading preferences...</span>
                    </div>
                  ) : (
                    <div className="border border-border bg-white/70 dark:bg-surface/70 backdrop-blur-sm p-6">
                      <h2 className="text-sm text-black dark:text-foreground font-semibold mb-5 flex items-center gap-2">
                        <div className="w-7 h-7 bg-warm/10 flex items-center justify-center">
                          <Bell size={13} className="text-warm" />
                        </div>
                        Research Preferences
                      </h2>
                      <div className="space-y-5">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm text-black dark:text-foreground">Auto-verify citations</p>
                            <p className="text-[11px] text-muted mt-0.5">
                              Automatically check every source against Crossref after search
                            </p>
                          </div>
                          <button
                            onClick={() => setAutoVerify(!autoVerify)}
                            className={`w-11 h-6 transition-colors duration-200 relative ${
                              autoVerify ? "bg-violet" : "bg-border"
                            }`}
                          >
                            <div
                              className={`w-5 h-5 bg-white absolute top-0.5 transition-all duration-200 ${
                                autoVerify ? "left-[22px]" : "left-0.5"
                              }`}
                            />
                          </button>
                        </div>

                        <div className="border-t border-border pt-5 flex items-center justify-between">
                          <div>
                            <p className="text-sm text-black dark:text-foreground">Synthesis mode</p>
                            <p className="text-[11px] text-muted mt-0.5">
                              Return AI-synthesized answers alongside search results
                            </p>
                          </div>
                          <button
                            onClick={() => setSynthesisMode(!synthesisMode)}
                            className={`w-11 h-6 transition-colors duration-200 relative ${
                              synthesisMode ? "bg-violet" : "bg-border"
                            }`}
                          >
                            <div
                              className={`w-5 h-5 bg-white absolute top-0.5 transition-all duration-200 ${
                                synthesisMode ? "left-[22px]" : "left-0.5"
                              }`}
                            />
                          </button>
                        </div>

                        <div className="border-t border-border pt-5">
                          <div className="flex items-center justify-between mb-3">
                            <div>
                              <p className="text-sm text-black dark:text-foreground">Results per query</p>
                              <p className="text-[11px] text-muted mt-0.5">
                                Number of sources returned per search (lower = faster, cheaper)
                              </p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            {["3", "5", "10"].map((n) => (
                              <button
                                key={n}
                                onClick={() => setMaxResults(n)}
                                className={`px-5 py-2.5 text-sm border transition-colors duration-200 ${
                                  maxResults === n
                                    ? "border-cyan text-cyan bg-cyan/8 font-medium"
                                    : "border-border text-gray hover:text-black dark:hover:text-foreground hover:border-black/20 dark:hover:border-white/20"
                                }`}
                              >
                                {n}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Danger zone */}
                  <div className="border border-red/20 bg-white/70 dark:bg-surface/70 backdrop-blur-sm p-6">
                    <h2 className="text-sm text-red/80 font-semibold mb-3 flex items-center gap-2">
                      <AlertTriangle size={14} className="text-red/60" />
                      Danger Zone
                    </h2>
                    <p className="text-xs text-gray mb-4">
                      These actions are irreversible. Proceed with caution.
                    </p>
                    <button
                      className="flex items-center gap-2 text-[11px] font-medium text-red/60 border border-red/15 hover:border-red/30 hover:text-red/80 hover:bg-red/5 px-4 py-2.5 transition-colors duration-200"
                    >
                      Request account deletion
                    </button>
                  </div>
                </div>
              )}

              {/* Save button */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, ease, delay: 0.15 }}
                className="mt-6 flex items-center gap-3"
              >
                <button
                  onClick={handleSave}
                  disabled={saving || loadingPrefs}
                  className="flex items-center gap-2 bg-violet text-white font-semibold text-sm px-6 py-2.5 hover:bg-violet/90 transition-colors duration-200 disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : saved ? (
                    <Check size={14} />
                  ) : (
                    <Save size={14} />
                  )}
                  {saving ? "Saving..." : saved ? "Saved" : "Save changes"}
                </button>
                <AnimatePresence>
                  {saved && (
                    <motion.span
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -8 }}
                      className="text-xs text-green font-medium"
                    >
                      Changes saved successfully
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.div>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}
