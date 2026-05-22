"use client";

/**
 * ShareLinkButton — mints a public share link for the current doc and
 * presents it in a tight popover with copy-to-clipboard.
 *
 * Reuses the existing `/api/share/mint` route (auth-gated, idempotent
 * per (doc, user) pair) so repeated clicks return the same URL until
 * it expires.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Share2, Loader2, Copy, Check, ExternalLink } from "lucide-react";
import { auth } from "@/lib/firebase/config";

interface ShareLinkButtonProps {
  documentId: string;
  /** Optional label override. Default "Share". */
  label?: string;
}

async function authHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) return {};
  try {
    const token = await user.getIdToken();
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
  }
}

export function ShareLinkButton({ documentId, label = "Share" }: ShareLinkButtonProps) {
  const [open, setOpen] = useState(false);
  const [minting, setMinting] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // Mint on first popover open so the user sees the URL immediately.
  useEffect(() => {
    if (!open || shareUrl || minting) return;
    let cancelled = false;
    (async () => {
       
      setMinting(true);
       
      setError(null);
      try {
        const headers = await authHeaders();
        const res = await fetch("/api/share/mint", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ documentId }),
        });
        if (!res.ok) {
          let detail = `Mint failed (${res.status})`;
          try {
            const data = (await res.json()) as { error?: string };
            if (data.error) detail = data.error;
          } catch {
            /* ignore */
          }
          throw new Error(detail);
        }
        const data = (await res.json()) as {
          url?: string;
          expiresAt?: number;
        };
        if (cancelled) return;
        if (typeof window !== "undefined" && data.url) {
          setShareUrl(window.location.origin + data.url);
        } else if (data.url) {
          setShareUrl(data.url);
        }
        if (typeof data.expiresAt === "number") setExpiresAt(data.expiresAt);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Couldn't create link");
        }
      } finally {
        if (!cancelled) setMinting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, shareUrl, minting, documentId]);

  const copy = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setError("Couldn't copy — select and copy manually.");
    }
  }, [shareUrl]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-3 py-2 text-[10px] uppercase tracking-[0.12em] font-semibold border transition-colors ${
          open
            ? "text-white bg-violet border-violet"
            : "text-violet border-violet/30 hover:bg-violet/[0.06]"
        }`}
        aria-expanded={open}
      >
        <Share2 size={11} strokeWidth={2} />
        <span className="hidden md:inline">{label}</span>
      </button>

      <AnimatePresence>
        {open ? (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setOpen(false)}
              aria-hidden
            />
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.97 }}
              transition={{ duration: 0.16 }}
              className="absolute right-0 top-full mt-1 w-80 bg-surface border border-border shadow-[0_24px_56px_-20px_rgba(0,0,0,0.35)] z-50 overflow-hidden"
            >
              <div className="px-4 pt-3 pb-2 border-b border-border">
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-semibold">
                  Public share link
                </p>
                <p className="text-[11.5px] text-foreground/85 mt-1.5 leading-relaxed">
                  Anyone with this link can read the document. They
                  don&apos;t need an account.
                </p>
              </div>

              <div className="px-4 py-3 space-y-2">
                {error ? (
                  <p className="text-[11px] text-rose leading-relaxed">{error}</p>
                ) : null}

                <div className="flex items-stretch border border-border bg-background">
                  <input
                    type="text"
                    value={minting ? "Creating link…" : shareUrl ?? ""}
                    readOnly
                    onFocus={(e) => e.target.select()}
                    className="flex-1 min-w-0 bg-transparent text-[12px] text-foreground px-3 py-2 focus:outline-none tabular-nums truncate"
                  />
                  <button
                    type="button"
                    onClick={copy}
                    disabled={!shareUrl || minting}
                    aria-label="Copy link"
                    className="flex items-center justify-center w-10 border-l border-border bg-violet text-white hover:bg-violet/90 disabled:bg-violet/40 transition-colors"
                  >
                    {minting ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : copied ? (
                      <Check size={12} strokeWidth={2.5} />
                    ) : (
                      <Copy size={12} strokeWidth={2} />
                    )}
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium">
                    {expiresAt
                      ? `Expires ${new Date(expiresAt).toLocaleDateString()}`
                      : "—"}
                  </span>
                  {shareUrl ? (
                    <a
                      href={shareUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] font-semibold text-violet hover:underline"
                    >
                      Open
                      <ExternalLink size={10} strokeWidth={2} />
                    </a>
                  ) : null}
                </div>
              </div>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
