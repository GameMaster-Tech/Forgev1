/**
 * Project starter templates — types.
 *
 * A `Template` is a frozen, deterministic fixture that produces a
 * fully-formed project: assertions, documents, habits, goals, and
 * optional constraint edges. Instantiation seeds Firestore for the
 * authenticated user (or returns in-memory shapes for unauthenticated
 * previews).
 *
 * Templates are pure data — no side effects in this file.
 */

import type { Assertion, ConstraintEdge, DocumentNode } from "../sync/types";
import type { Goal, Habit } from "../scheduler";

export type TemplateKey =
  | "founder"
  | "researcher"
  | "consultant"
  | "policy"
  | "legal";

export interface TemplateProject {
  /** Project id assigned at instantiation. Templates leave this blank. */
  id: string;
  name: string;
  description: string;
  mode: "lightning" | "reasoning" | "deep";
}

export interface Template {
  key: TemplateKey;
  /** Display name in the picker. */
  label: string;
  /** One-line subtitle. */
  blurb: string;
  /** Persona icon tone for the picker card. */
  tone: "violet" | "cyan" | "warm" | "rose" | "green";
  /** ≤ 280-char "why this template" copy. */
  why: string;
  /** Seed assertions for Sync to operate on. */
  assertions: Omit<Assertion, "projectId">[];
  /** Seed documents (will be hosted under the new project). */
  documents: Omit<DocumentNode, "projectId">[];
  /** Seed constraint edges. */
  constraints: Omit<ConstraintEdge, "projectId">[];
  /** Seed habits. */
  habits: Omit<Habit, "projectId" | "ownerId">[];
  /** Seed goals. */
  goals: Omit<Goal, "projectId" | "ownerId">[];
  /** Free-form markdown sections per doc, keyed by document id. */
  blockBodies?: Record<string, string>;
  /** Suggested project metadata. */
  project: Omit<TemplateProject, "id">;
}

export interface InstantiatedProject {
  projectId: string;
  /** Same fields as Template, but with projectId stitched in. */
  assertions: Assertion[];
  documents: DocumentNode[];
  constraints: ConstraintEdge[];
  habits: Habit[];
  goals: Goal[];
  templateKey: TemplateKey;
  instantiatedAt: number;
}
