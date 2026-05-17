"use client";

/**
 * useFocusTrap — trap focus inside a container and close on Escape.
 *
 * Wires the standard a11y dialog pattern:
 *   • on open, focus the first tabbable element inside the container;
 *   • Tab / Shift+Tab wrap within the container;
 *   • Escape calls onClose;
 *   • on close, focus returns to whoever opened the dialog.
 *
 * Returns a `containerRef` to attach to the modal/drawer root.
 */

import { useEffect, useRef } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function useFocusTrap<T extends HTMLElement = HTMLDivElement>({
  active,
  onClose,
}: {
  active: boolean;
  onClose: () => void;
}) {
  const containerRef = useRef<T | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;

    // Remember the trigger so we can restore focus on close.
    lastFocusedRef.current = (document.activeElement as HTMLElement) ?? null;

    const node = containerRef.current;
    if (node) {
      // Defer one tick so React has actually mounted the children.
      const first = node.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const focusables = Array.from(
        node.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => !el.hasAttribute("inert") && el.offsetParent !== null);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const current = document.activeElement as HTMLElement | null;
      if (e.shiftKey && current === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      lastFocusedRef.current?.focus?.();
    };
  }, [active, onClose]);

  return containerRef;
}
