/**
 * Templates — public registry + instantiator.
 */

import type { Assertion, ConstraintEdge, DocumentNode } from "../sync/types";
import type { Goal, Habit } from "../scheduler";
import { CONSULTANT_TEMPLATE } from "./consultant";
import { FOUNDER_TEMPLATE } from "./founder";
import { LEGAL_TEMPLATE } from "./legal";
import { POLICY_TEMPLATE } from "./policy";
import { RESEARCHER_TEMPLATE } from "./researcher";
import type { InstantiatedProject, Template, TemplateKey } from "./types";

const ALL: Record<TemplateKey, Template> = {
  founder:    FOUNDER_TEMPLATE,
  researcher: RESEARCHER_TEMPLATE,
  consultant: CONSULTANT_TEMPLATE,
  policy:     POLICY_TEMPLATE,
  legal:      LEGAL_TEMPLATE,
};

export function listTemplates(): Template[] {
  return Object.values(ALL);
}

export function getTemplate(key: TemplateKey): Template {
  return ALL[key];
}

export type { Template, TemplateKey, InstantiatedProject } from "./types";

/**
 * Materialise a Template into a concrete project shape. Pure — no
 * Firestore writes. The caller is responsible for persisting the
 * returned shapes (the wizard does this in the projects page or via
 * an /api/projects POST in the future).
 */
export function instantiateTemplate(
  key: TemplateKey,
  projectId: string,
  ownerId: string,
  now: number = Date.now(),
): InstantiatedProject {
  const tpl = ALL[key];
  if (!tpl) throw new Error(`Unknown template: ${key}`);

  const assertions: Assertion[]   = tpl.assertions.map((a) => ({ ...a, projectId }));
  const documents:  DocumentNode[] = tpl.documents.map((d) => ({ ...d, projectId }));
  const constraints: ConstraintEdge[] = tpl.constraints.map((c) => ({ ...c, projectId }));
  const habits: Habit[] = tpl.habits.map((h) => ({ ...h, projectId, ownerId }));
  const goals: Goal[]   = tpl.goals.map((g)  => ({ ...g, projectId, ownerId }));

  return {
    projectId,
    assertions,
    documents,
    constraints,
    habits,
    goals,
    templateKey: key,
    instantiatedAt: now,
  };
}
