"use client";

/**
 * InvariantList — top-level container for the Phase 4 builder.
 *
 * Renders the catalogue picker (add-new strip), an evaluating banner,
 * and the live list of `InvariantBuilder` cards. State lives in the
 * `useInvariants` hook the page wires in.
 */

import { Plus, ShieldCheck, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useMemo } from "react";
import { InvariantBuilder } from "./InvariantBuilder";
import {
  INVARIANT_CATALOGUE,
  type InvariantConfig,
  type InvariantKind,
} from "@/lib/forge-graph/invariant-dsl";
import type { PersistedInvariant } from "@/lib/forge-graph/invariant-store";
import type { ForgeGraphNode, NodeId } from "@/lib/forge-graph";
import { compileInvariant } from "@/lib/forge-graph/invariant-dsl";

const EASE = [0.22, 0.61, 0.36, 1] as const;

interface InvariantListProps {
  invariants: PersistedInvariant[];
  loading: boolean;
  error: string | null;
  onAdd: (kind: InvariantKind) => Promise<unknown>;
  onUpdate: (id: string, patch: Partial<InvariantConfig>) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  /** Optional live graph for per-rule pass/fail evaluation. */
  graph?: Map<NodeId, ForgeGraphNode>;
}

export function InvariantList({
  invariants,
  loading,
  error,
  onAdd,
  onUpdate,
  onRemove,
  graph,
}: InvariantListProps) {
  // Evaluate each compiled invariant against the live graph so the user
  // can see which rules are passing right now.
  const statuses = useMemo(() => {
    if (!graph) return new Map<string, { passed: boolean; detail?: string }>();
    const out = new Map<string, { passed: boolean; detail?: string }>();
    for (const i of invariants) {
      const compiled = compileInvariant(i);
      if (!compiled) {
        out.set(i.id, { passed: true });
        continue;
      }
      try {
        const result = compiled.evaluator(graph);
        out.set(i.id, { passed: result.passed, detail: result.errorDetail });
      } catch (err) {
        out.set(i.id, {
          passed: false,
          detail: err instanceof Error ? err.message : "Evaluation failed",
        });
      }
    }
    return out;
  }, [invariants, graph]);

  const failingCount = useMemo(() => {
    let n = 0;
    for (const s of statuses.values()) if (!s.passed) n += 1;
    return n;
  }, [statuses]);

  return (
    <div className="space-y-6">
      {/* status banner */}
      <div className="flex items-center gap-3 border border-border bg-surface px-4 py-3">
        {failingCount === 0 ? (
          <>
            <ShieldCheck size={14} strokeWidth={1.75} className="text-green" />
            <span className="text-[10px] uppercase tracking-[0.16em] font-semibold text-green">
              All {invariants.length} invariant{invariants.length === 1 ? "" : "s"} passing
            </span>
          </>
        ) : (
          <>
            <AlertTriangle size={14} strokeWidth={1.75} className="text-rose" />
            <span className="text-[10px] uppercase tracking-[0.16em] font-semibold text-rose">
              {failingCount} failing
            </span>
            <span className="text-[10px] uppercase tracking-[0.12em] text-muted">
              · {invariants.length - failingCount} passing
            </span>
          </>
        )}
        {loading ? (
          <span className="ml-auto text-[9px] uppercase tracking-[0.16em] text-muted">
            Loading…
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="border border-rose/40 bg-rose/[0.06] text-rose text-[12px] px-4 py-3">
          {error}
        </div>
      ) : null}

      {/* add new strip */}
      <div>
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
          Add invariant
        </p>
        <div className="flex flex-wrap gap-2">
          {INVARIANT_CATALOGUE.map((meta) => (
            <button
              key={meta.kind}
              type="button"
              onClick={() => void onAdd(meta.kind)}
              className="group inline-flex items-center gap-1.5 border border-border bg-surface px-3 py-2 text-[11px] text-foreground hover:border-violet/50 hover:bg-violet/[0.04] transition-colors"
              title={meta.summary}
            >
              <Plus size={11} strokeWidth={2} className="text-violet" />
              <span className="uppercase tracking-[0.12em] font-medium">{meta.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* list */}
      <div className="space-y-3">
        <AnimatePresence initial={false}>
          {invariants.map((inv) => (
            <motion.div
              key={inv.id}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.22, ease: EASE }}
            >
              <InvariantBuilder
                config={inv}
                status={statuses.get(inv.id)}
                onChange={(patch) => void onUpdate(inv.id, patch)}
                onRemove={() => void onRemove(inv.id)}
              />
            </motion.div>
          ))}
        </AnimatePresence>

        {invariants.length === 0 && !loading ? (
          <div className="border border-dashed border-border bg-surface/40 p-10 text-center">
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted">
              No invariants yet
            </p>
            <p className="text-[12px] text-muted mt-2 max-w-md mx-auto leading-relaxed">
              Add a rule above to start constraining sandbox scenarios.
              Failing rules block the merge; non-blocking rules bump
              risk score but allow override.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
