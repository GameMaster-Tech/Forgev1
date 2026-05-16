/**
 * ClaimMention — TipTap inline node that renders `[[claim:<key>]]` patterns
 * as live, colored pills.
 *
 *   "$[[claim:engineering.senior.salary]]$" → rendered pill keyed on
 *   `engineering.senior.salary` with a colour driven by Pulse trust:
 *     green  ≥ 80%   "fresh"
 *     warm   50–80%  "drifting"
 *     rose   < 50%   "invalidated"
 *
 * The pill subscribes to a `ClaimTrustResolver` injected at extension
 * config time. Resolvers return the latest value + source + last-refresh
 * timestamp so the click tooltip can render rich data. When no resolver
 * is provided, the pill renders in a neutral state with the raw key.
 *
 * Click → tooltip popover anchored to the pill. Tooltip auto-dismisses
 * on outside-click or Escape.
 *
 * The node is `atom: true` and `inline: true` so the editor treats it
 * as a single uninterruptable token. Stored as `data-claim-key` so
 * round-trip persistence keeps the reference intact.
 */

import { Node as TipTapNode, mergeAttributes, nodeInputRule } from "@tiptap/core";

/* ───────────── trust resolver contract ───────────── */

export interface ClaimSnapshot {
  /** 0..1 trust score (drives pill colour). */
  trust: number;
  /** Most recent value the workspace believes for the claim. */
  value?: string;
  /** Source string ("Levels.fyi median May 2026", "Board mandate", …). */
  source?: string;
  /** ISO timestamp of the last refresh. */
  lastRefreshedAt?: string;
  /** Pulse status verdict ("fresh" | "stale" | "invalidated"). */
  status?: "fresh" | "stale" | "invalidated";
}

export type ClaimTrustResolver = (key: string) => ClaimSnapshot | null;

/** Default neutral snapshot — used when no resolver is provided. */
const NEUTRAL: ClaimSnapshot = { trust: 1 };

export interface ClaimMentionOptions {
  /** Pluggable resolver. Pulse + Sync wire their state here. */
  resolveTrust: ClaimTrustResolver;
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    claimMention: {
      insertClaimMention: (key: string) => ReturnType;
    };
  }
}

/* ───────────── visual helpers ───────────── */

function pillToneClasses(trust: number): { container: string; dot: string; label: string } {
  if (trust >= 0.8) {
    return {
      container: "border-green/40 bg-green/[0.08] text-green",
      dot: "bg-green",
      label: "Fresh",
    };
  }
  if (trust >= 0.5) {
    return {
      container: "border-warm/45 bg-warm/[0.08] text-warm",
      dot: "bg-warm",
      label: "Drifting",
    };
  }
  return {
    container: "border-rose/45 bg-rose/[0.08] text-rose",
    dot: "bg-rose",
    label: "Invalidated",
  };
}

function buildPill(key: string, snap: ClaimSnapshot): HTMLSpanElement {
  const span = document.createElement("span");
  const tone = pillToneClasses(snap.trust);
  span.className =
    `forge-claim-pill inline-flex items-center gap-1.5 border px-1.5 py-[1px] mx-[1px] text-[11.5px] font-medium leading-snug align-baseline cursor-pointer select-none ${tone.container}`;
  span.setAttribute("data-claim-key", key);
  span.setAttribute("data-claim-trust", `${snap.trust}`);
  span.contentEditable = "false";

  const dot = document.createElement("span");
  dot.className = `w-1 h-1 ${tone.dot}`;
  span.appendChild(dot);

  const label = document.createElement("span");
  label.textContent = key;
  span.appendChild(label);
  return span;
}

function buildTooltip(key: string, snap: ClaimSnapshot): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className =
    "forge-claim-tooltip absolute z-50 mt-1.5 w-[300px] max-w-[80vw] bg-foreground text-background border border-white/10 shadow-[0_18px_44px_-18px_rgba(0,0,0,0.45)] p-3";

  const head = document.createElement("div");
  head.className = "flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] font-semibold text-background/70 mb-1.5";
  head.textContent = pillToneClasses(snap.trust).label.toUpperCase();
  wrap.appendChild(head);

  const k = document.createElement("p");
  k.className = "text-[10px] uppercase tracking-[0.12em] text-background/55 font-medium";
  k.textContent = "Key";
  wrap.appendChild(k);
  const kv = document.createElement("code");
  kv.className = "block text-[12px] text-background mb-2";
  kv.textContent = key;
  wrap.appendChild(kv);

  if (snap.value) {
    const lv = document.createElement("p");
    lv.className = "text-[10px] uppercase tracking-[0.12em] text-background/55 font-medium";
    lv.textContent = "Latest value";
    wrap.appendChild(lv);
    const v = document.createElement("p");
    v.className = "text-[13px] text-background font-medium mb-2 tabular-nums";
    v.textContent = snap.value;
    wrap.appendChild(v);
  }

  if (snap.source) {
    const sl = document.createElement("p");
    sl.className = "text-[10px] uppercase tracking-[0.12em] text-background/55 font-medium";
    sl.textContent = "Source";
    wrap.appendChild(sl);
    const s = document.createElement("p");
    s.className = "text-[12px] text-background/85 mb-2";
    s.textContent = snap.source;
    wrap.appendChild(s);
  }

  if (snap.lastRefreshedAt) {
    const r = document.createElement("p");
    r.className = "text-[10px] uppercase tracking-[0.12em] text-background/55 font-medium tabular-nums";
    r.textContent = `Last refreshed ${snap.lastRefreshedAt}`;
    wrap.appendChild(r);
  }

  const t = document.createElement("p");
  t.className = "text-[10px] uppercase tracking-[0.12em] text-background/55 font-medium mt-1.5 tabular-nums";
  t.textContent = `Trust ${Math.round(snap.trust * 100)}%`;
  wrap.appendChild(t);

  return wrap;
}

/* ───────────── extension ───────────── */

export const ClaimMention = TipTapNode.create<ClaimMentionOptions>({
  name: "claimMention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  marks: "",

  addOptions(): ClaimMentionOptions {
    return {
      // Default resolver — returns neutral snapshot.
      resolveTrust: () => NEUTRAL,
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      claimKey: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-claim-key") ?? "",
        renderHTML: (attrs) => ({ "data-claim-key": attrs.claimKey }),
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'span[data-type="claim-mention"]' },
      { tag: "span.forge-claim-pill" },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const key = (node.attrs.claimKey as string) ?? "";
    return [
      "span",
      mergeAttributes(
        {
          "data-type": "claim-mention",
          class: "forge-claim-pill",
        },
        this.options.HTMLAttributes,
        HTMLAttributes,
      ),
      `[[claim:${key}]]`,
    ];
  },

  addNodeView() {
    const resolveTrust = this.options.resolveTrust;
    return ({ node, getPos, editor }) => {
      const host = document.createElement("span");
      host.style.position = "relative";
      host.style.display = "inline-block";

      let pill: HTMLSpanElement;
      let tooltip: HTMLDivElement | null = null;
      let lastSnapshot: ClaimSnapshot = NEUTRAL;

      const render = () => {
        const key = (node.attrs.claimKey as string) ?? "";
        const snap = (key ? resolveTrust(key) : null) ?? NEUTRAL;
        lastSnapshot = snap;
        const next = buildPill(key, snap);
        if (pill) host.replaceChild(next, pill);
        else host.appendChild(next);
        pill = next;
        bindHandlers(key, snap);
      };

      const closeTooltip = () => {
        if (tooltip && tooltip.parentNode) {
          tooltip.parentNode.removeChild(tooltip);
        }
        tooltip = null;
        document.removeEventListener("mousedown", outsideHandler);
        document.removeEventListener("keydown", escHandler);
      };

      const outsideHandler = (e: MouseEvent) => {
        if (!tooltip) return;
        if (!host.contains(e.target as Node)) closeTooltip();
      };
      const escHandler = (e: KeyboardEvent) => {
        if (e.key === "Escape") closeTooltip();
      };

      const openTooltip = (key: string, snap: ClaimSnapshot) => {
        closeTooltip();
        const t = buildTooltip(key, snap);
        host.appendChild(t);
        tooltip = t;
        document.addEventListener("mousedown", outsideHandler);
        document.addEventListener("keydown", escHandler);
      };

      const bindHandlers = (key: string, snap: ClaimSnapshot) => {
        pill.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (tooltip) {
            closeTooltip();
            return;
          }
          openTooltip(key, snap);
          // Focus the editor so cursor doesn't disappear behind the
          // tooltip on browsers that move it on click.
          const pos = typeof getPos === "function" ? getPos() : null;
          if (pos != null) {
            try {
              editor.chain().focus().setNodeSelection(pos).run();
            } catch {
              /* selection may fail if the node is gone — ignore */
            }
          }
        };
      };

      render();

      return {
        dom: host,
        update: (updatedNode) => {
          if (updatedNode.type.name !== "claimMention") return false;
          // Re-render iff the resolver returns a fresh snapshot or the
          // attrs changed. Re-rendering is cheap so we always do it.
          const newKey = (updatedNode.attrs.claimKey as string) ?? "";
          const newSnap = (newKey ? resolveTrust(newKey) : null) ?? NEUTRAL;
          if (
            newKey === ((node as unknown as { attrs: Record<string, unknown> }).attrs.claimKey as string) &&
            newSnap.trust === lastSnapshot.trust &&
            newSnap.value === lastSnapshot.value
          ) {
            return true;
          }
          (node as unknown as { attrs: Record<string, unknown> }).attrs.claimKey = newKey;
          render();
          return true;
        },
        destroy: () => closeTooltip(),
      };
    };
  },

  addCommands() {
    return {
      insertClaimMention:
        (key: string) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { claimKey: key },
          }),
    };
  },

  addInputRules() {
    return [
      // Match `[[claim:<key>]]` followed by a space so the rule fires
      // exactly once at the moment the user closes the pattern.
      nodeInputRule({
        find: /\[\[claim:([a-zA-Z0-9_.\-/]+)\]\]\s$/,
        type: this.type,
        getAttributes: (match) => ({ claimKey: match[1].trim() }),
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-c": () => {
        const key = window.prompt("Claim key (e.g. engineering.senior.salary):", "");
        if (!key) return false;
        return this.editor.chain().focus().insertClaimMention(key.trim()).run();
      },
    };
  },
});

export default ClaimMention;
