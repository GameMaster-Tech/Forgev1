"use client";

/**
 * TrySaying — reusable "Try saying…" voice-prompt chips for empty states.
 *
 * Each chip is one-click executable: clicking dispatches an `aria:ui` "run"
 * event that PresenceLayer feeds straight to Aria. So a cold-start user who
 * hasn't enabled the mic yet can still *see* and *trigger* what Aria does — the
 * fastest possible path from blank screen to "oh, it just did that".
 */

import { Mic } from "lucide-react";

export function TrySaying({
  prompts,
  className = "",
}: {
  prompts: string[];
  className?: string;
}) {
  if (prompts.length === 0) return null;

  const run = (transcript: string) => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("aria:ui", { detail: { kind: "run", transcript } }));
  };

  return (
    <div className={className}>
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted/70 font-semibold mb-2.5 flex items-center gap-1.5">
        <Mic size={11} className="text-[color:var(--voice)]" strokeWidth={2.25} />
        Try saying
      </div>
      <div className="flex flex-wrap gap-2">
        {prompts.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => run(t)}
            title="Ask Aria to do this"
            className="inline-flex items-center text-[12px] text-foreground/85 hover:text-foreground border rounded-[0.375rem] px-2.5 py-1.5 text-left transition-colors"
            style={{
              background: "color-mix(in srgb, var(--voice) 8%, var(--background))",
              borderColor: "color-mix(in srgb, var(--voice) 28%, var(--border))",
            }}
          >
            <span className="text-[color:var(--voice)] mr-0.5">“</span>
            {t}
            <span className="text-[color:var(--voice)] ml-0.5">”</span>
          </button>
        ))}
      </div>
    </div>
  );
}
