"use client";

/**
 * ErrorBoundary — a reusable, in-place React error boundary.
 *
 * Next's route-level `error.tsx` catches server-render failures, but a
 * client component that throws *after* hydration (a bad render in a side
 * panel, a graph, a widget) should degrade locally without blanking the
 * whole surface. Wrap any volatile subtree in this to get a calm, branded,
 * retryable fallback instead of a white screen.
 *
 *   <ErrorBoundary label="Research panel">
 *     <ResearchSidePanel … />
 *   </ErrorBoundary>
 *
 * Pass `fallback` for a bespoke fallback, or rely on the default card.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { RotateCw } from "lucide-react";

interface Props {
  children: ReactNode;
  /** Short human label for what failed, e.g. "Research panel". */
  label?: string;
  /** Custom fallback. Receives a `retry` fn to clear the error state. */
  fallback?: (retry: () => void, error: Error) => ReactNode;
  /** Notified on capture — hook up to Sentry etc. */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("ErrorBoundary caught:", this.props.label ?? "", error);
    this.props.onError?.(error, info);
  }

  private retry = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(this.retry, error);

    return (
      <div className="flex flex-col items-center justify-center gap-3 p-8 text-center border border-border bg-surface/50 min-h-[160px]">
        <p className="text-[11px] uppercase tracking-[0.18em] text-rose font-medium">
          {this.props.label ? `${this.props.label} failed` : "This part failed"}
        </p>
        <p className="text-[12.5px] text-muted leading-relaxed max-w-xs">
          It hit an error and stopped rendering. The rest of the page is fine.
        </p>
        <button
          type="button"
          onClick={this.retry}
          className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] font-semibold text-foreground border border-border hover:border-foreground/30 px-3.5 py-2 transition-colors"
        >
          <RotateCw size={11} strokeWidth={2} />
          Retry
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
