/**
 * InlineEmbed — TipTap extension that auto-detects common embed URLs
 * (YouTube, Loom, Vimeo, Figma, Twitter / X) and renders them inline
 * as responsive iframes.
 *
 * Detection runs as a Paste rule: the user pastes a URL, the rule
 * matches, and the URL becomes a block-level `inlineEmbed` node.
 * Falls through to the regular Link extension when the URL doesn't
 * match a known provider, so existing link behaviour is unchanged.
 *
 * Persistence: stored as a `data-embed-src` attribute on the rendered
 * `div`, which survives HTML round-trips through Tiptap's
 * `getHTML()` / `setContent()`.
 */

import { Node, mergeAttributes, nodePasteRule } from "@tiptap/core";

interface EmbedProvider {
  id: string;
  /** Pattern that should match the FULL URL. */
  match: RegExp;
  /** Build the iframe src from the matched URL. */
  toEmbedSrc: (url: string, match: RegExpMatchArray) => string;
  /** Aspect ratio (height / width) — 0.5625 = 16:9. */
  aspectRatio: number;
  label: string;
}

const PROVIDERS: EmbedProvider[] = [
  {
    id: "youtube",
    label: "YouTube",
    match:
      /^https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,12})(?:[?&#].*)?$/,
    toEmbedSrc: (_url, m) => `https://www.youtube.com/embed/${m[1]}`,
    aspectRatio: 0.5625,
  },
  {
    id: "youtube-short",
    label: "YouTube",
    match: /^https?:\/\/(?:www\.)?youtube\.com\/shorts\/([\w-]{6,12})/,
    toEmbedSrc: (_url, m) => `https://www.youtube.com/embed/${m[1]}`,
    aspectRatio: 1.778, // 9:16 vertical
  },
  {
    id: "loom",
    label: "Loom",
    match: /^https?:\/\/(?:www\.)?loom\.com\/share\/([a-f0-9]{20,})/,
    toEmbedSrc: (_url, m) => `https://www.loom.com/embed/${m[1]}`,
    aspectRatio: 0.5625,
  },
  {
    id: "vimeo",
    label: "Vimeo",
    match: /^https?:\/\/(?:www\.)?vimeo\.com\/(\d{6,})/,
    toEmbedSrc: (_url, m) => `https://player.vimeo.com/video/${m[1]}`,
    aspectRatio: 0.5625,
  },
  {
    id: "figma",
    label: "Figma",
    match: /^https?:\/\/(?:www\.)?figma\.com\/(file|design|proto)\/[^?\s]+/,
    toEmbedSrc: (url) =>
      `https://www.figma.com/embed?embed_host=forge&url=${encodeURIComponent(url)}`,
    aspectRatio: 0.625,
  },
  {
    id: "twitter",
    label: "X (Twitter)",
    match:
      /^https?:\/\/(?:twitter\.com|x\.com)\/[^/]+\/status\/(\d{10,})(?:[?#].*)?$/,
    toEmbedSrc: (url) =>
      `https://platform.twitter.com/embed/Tweet.html?url=${encodeURIComponent(url)}`,
    aspectRatio: 0.78,
  },
];

function resolveProvider(
  url: string,
): { provider: EmbedProvider; src: string } | null {
  for (const p of PROVIDERS) {
    const m = url.match(p.match);
    if (m) return { provider: p, src: p.toEmbedSrc(url, m) };
  }
  return null;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    inlineEmbed: {
      /** Insert an embed for a known URL; no-op for unknown providers. */
      insertInlineEmbed: (url: string) => ReturnType;
    };
  }
}

export const InlineEmbed = Node.create({
  name: "inlineEmbed",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      url: { default: "" },
      provider: { default: "" },
      embedSrc: { default: "" },
      aspectRatio: { default: 0.5625 },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-forge-node="inline-embed"]',
        getAttrs: (el) => {
          if (typeof el === "string") return false;
          const url = el.getAttribute("data-embed-url") ?? "";
          const resolved = resolveProvider(url);
          if (!resolved) return false;
          return {
            url,
            provider: resolved.provider.id,
            embedSrc: resolved.src,
            aspectRatio: resolved.provider.aspectRatio,
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const url = (HTMLAttributes.url as string | undefined) ?? "";
    const embedSrc = (HTMLAttributes.embedSrc as string | undefined) ?? "";
    const provider = (HTMLAttributes.provider as string | undefined) ?? "";
    const aspectRatio = (HTMLAttributes.aspectRatio as number | undefined) ?? 0.5625;
    return [
      "div",
      mergeAttributes(
        {
          "data-forge-node": "inline-embed",
          "data-embed-url": url,
          "data-embed-provider": provider,
          class: "forge-inline-embed",
          style: `position:relative;padding-bottom:${aspectRatio * 100}%;margin:1em 0;background:var(--surface);border:1px solid var(--border);`,
        },
        HTMLAttributes,
      ),
      [
        "iframe",
        {
          src: embedSrc,
          loading: "lazy",
          allow:
            "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
          allowfullscreen: "",
          style:
            "position:absolute;top:0;left:0;width:100%;height:100%;border:0;",
        },
      ],
    ];
  },

  addCommands() {
    return {
      insertInlineEmbed:
        (url: string) =>
        ({ chain }) => {
          const resolved = resolveProvider(url);
          if (!resolved) return false;
          return chain()
            .focus()
            .insertContent({
              type: this.name,
              attrs: {
                url,
                provider: resolved.provider.id,
                embedSrc: resolved.src,
                aspectRatio: resolved.provider.aspectRatio,
              },
            })
            .run();
        },
    };
  },

  addPasteRules() {
    return [
      // Match any URL on its own line; the rule's `getAttributes`
      // delegates to `resolveProvider` so non-embedable URLs are
      // ignored and fall through to the regular Link extension.
      nodePasteRule({
        find: /https?:\/\/[^\s]+/g,
        type: this.type,
        getAttributes: (match) => {
          const url = match[0];
          const resolved = resolveProvider(url);
          if (!resolved) return false;
          return {
            url,
            provider: resolved.provider.id,
            embedSrc: resolved.src,
            aspectRatio: resolved.provider.aspectRatio,
          };
        },
      }),
    ];
  },
});
