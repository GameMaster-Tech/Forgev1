/**
 * In-memory dependency graph for a single project.
 *
 * Indexed both ways: by assertion id and by the constraints that touch it.
 * This makes propagation cheap: when one assertion changes, we can find
 * everything downstream in O(degree).
 */

import type {
  Assertion,
  AssertionId,
  ConstraintEdge,
  ConstraintId,
  DocumentId,
  DocumentNode,
} from "./types";

export class DependencyGraph {
  readonly projectId: string;

  private assertions = new Map<AssertionId, Assertion>();
  private documents = new Map<DocumentId, DocumentNode>();
  private constraints = new Map<ConstraintId, ConstraintEdge>();

  /** AssertionId → constraint ids where it appears on either side. */
  private adjacency = new Map<AssertionId, Set<ConstraintId>>();

  constructor(projectId: string) {
    this.projectId = projectId;
  }

  /* ── Mutations ─────────────────────────────────────────────── */

  upsertDocument(doc: DocumentNode): void {
    this.requireProject(doc.projectId);
    this.documents.set(doc.id, { ...doc, assertionIds: [...doc.assertionIds] });
  }

  upsertAssertion(a: Assertion): void {
    this.requireProject(a.projectId);
    this.assertions.set(a.id, { ...a });
    if (!this.adjacency.has(a.id)) this.adjacency.set(a.id, new Set());
    // Keep the document's id list in sync.
    const doc = this.documents.get(a.documentId);
    if (doc && !doc.assertionIds.includes(a.id)) {
      doc.assertionIds.push(a.id);
    }
  }

  upsertConstraint(edge: ConstraintEdge): void {
    this.requireProject(edge.projectId);
    this.constraints.set(edge.id, edge);
    for (const id of this.fromIds(edge)) this.touch(id, edge.id);
    this.touch(edge.to, edge.id);
  }

  removeAssertion(id: AssertionId): void {
    this.assertions.delete(id);
    const touched = this.adjacency.get(id);
    if (touched) {
      for (const cid of touched) this.constraints.delete(cid);
      this.adjacency.delete(id);
    }
  }

  /* ── Reads ─────────────────────────────────────────────────── */

  getAssertion(id: AssertionId): Assertion | undefined {
    return this.assertions.get(id);
  }

  getDocument(id: DocumentId): DocumentNode | undefined {
    return this.documents.get(id);
  }

  getConstraint(id: ConstraintId): ConstraintEdge | undefined {
    return this.constraints.get(id);
  }

  listAssertions(): Assertion[] {
    return Array.from(this.assertions.values());
  }

  listDocuments(): DocumentNode[] {
    return Array.from(this.documents.values());
  }

  listConstraints(): ConstraintEdge[] {
    return Array.from(this.constraints.values());
  }

  constraintsTouching(id: AssertionId): ConstraintEdge[] {
    const ids = this.adjacency.get(id);
    if (!ids) return [];
    const out: ConstraintEdge[] = [];
    for (const cid of ids) {
      const c = this.constraints.get(cid);
      if (c) out.push(c);
    }
    return out;
  }

  /** Assertions reachable from `id` along constraint edges, BFS. */
  downstream(id: AssertionId, maxDepth = 6): AssertionId[] {
    const seen = new Set<AssertionId>([id]);
    const out: AssertionId[] = [];
    let frontier: AssertionId[] = [id];
    let depth = 0;
    while (frontier.length && depth < maxDepth) {
      const next: AssertionId[] = [];
      for (const cur of frontier) {
        for (const c of this.constraintsTouching(cur)) {
          // Only follow forward edges (from → to). For multi-source
          // constraints, `to` is reachable from any element in `from`.
          if (this.fromIds(c).includes(cur) && !seen.has(c.to)) {
            seen.add(c.to);
            next.push(c.to);
            out.push(c.to);
          }
        }
      }
      frontier = next;
      depth++;
    }
    return out;
  }

  /* ── Internals ─────────────────────────────────────────────── */

  private touch(aid: AssertionId, cid: ConstraintId): void {
    let set = this.adjacency.get(aid);
    if (!set) {
      set = new Set();
      this.adjacency.set(aid, set);
    }
    set.add(cid);
  }

  private fromIds(edge: ConstraintEdge): AssertionId[] {
    return Array.isArray(edge.from) ? edge.from : [edge.from];
  }

  private requireProject(pid: string): void {
    if (pid !== this.projectId) {
      throw new Error(
        `DependencyGraph(${this.projectId}) cannot ingest entity from project ${pid}`,
      );
    }
  }
}
