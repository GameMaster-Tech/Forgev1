import type { Page } from "@playwright/test";

/**
 * Wait until every animating element has either reached opacity:1
 * (i.e. the framer-motion fade-in finished) or removed its inline
 * transform. axe-core measures color contrast against the rendered
 * pixel, so an element mid-fade reports false contrast failures.
 *
 * 1500 ms covers the longest entrance animation in the app
 * (`duration: 0.35` plus delays).
 */
export async function waitForAnimationsToSettle(page: Page, timeoutMs = 2000): Promise<void> {
  await page.waitForFunction(
    () => {
      const els = Array.from(document.querySelectorAll<HTMLElement>("[style*='opacity']"));
      return els.every((el) => {
        const opacity = Number(window.getComputedStyle(el).opacity);
        return Number.isNaN(opacity) || opacity >= 0.999 || opacity === 0;
      });
    },
    null,
    { timeout: timeoutMs },
  ).catch(() => {
    /* timed out — fall through anyway so axe gets to scan something */
  });

  // Belt-and-braces — also wait for any prefers-reduced-motion-aware
  // CSS transitions to flush.
  await page.waitForTimeout(150);
}
