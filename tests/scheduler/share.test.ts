import { describe, it, expect } from "vitest";
import {
  decideAccess,
  grant,
  revoke,
  pruneExpired,
  createPublicLink,
  ROLE_LABELS,
  ROLE_DESCRIPTIONS,
} from "@/lib/scheduler/share";
import type { ShareGrant, ShareRole } from "@/lib/scheduler/types";

const NOW = 1_700_000_000_000;

function shareGrant(overrides: Partial<ShareGrant> = {}): ShareGrant {
  return {
    id: "g1",
    resource: { kind: "calendar", id: "c1" },
    principal: { kind: "user", id: "u1" },
    role: "viewer",
    grantedBy: "owner",
    grantedAt: NOW - 1000,
    ...overrides,
  };
}

describe("decideAccess", () => {
  it("denies access with no grant", () => {
    const r = decideAccess([], { kind: "calendar", id: "c1" }, { kind: "user", id: "u1" }, "read.details", NOW);
    expect(r.allowed).toBe(false);
    expect(r.effectiveRole).toBeNull();
  });

  it("allows read.details for a viewer", () => {
    const r = decideAccess([shareGrant({ role: "viewer" })], { kind: "calendar", id: "c1" }, { kind: "user", id: "u1" }, "read.details", NOW);
    expect(r.allowed).toBe(true);
    expect(r.effectiveRole).toBe("viewer");
  });

  it("denies write.update for a viewer", () => {
    const r = decideAccess([shareGrant({ role: "viewer" })], { kind: "calendar", id: "c1" }, { kind: "user", id: "u1" }, "write.update", NOW);
    expect(r.allowed).toBe(false);
    expect(r.effectiveRole).toBe("viewer");
  });

  it("allows write.update for an editor", () => {
    const r = decideAccess([shareGrant({ role: "editor" })], { kind: "calendar", id: "c1" }, { kind: "user", id: "u1" }, "write.update", NOW);
    expect(r.allowed).toBe(true);
  });

  it("requires owner for write.share", () => {
    const r = decideAccess([shareGrant({ role: "editor" })], { kind: "calendar", id: "c1" }, { kind: "user", id: "u1" }, "write.share", NOW);
    expect(r.allowed).toBe(false);
  });

  it("ignores expired grants", () => {
    const expired = shareGrant({ role: "owner", expiresAt: new Date(NOW - 1000).toISOString() });
    const r = decideAccess([expired], { kind: "calendar", id: "c1" }, { kind: "user", id: "u1" }, "read.details", NOW);
    expect(r.allowed).toBe(false);
  });

  it("picks the strongest non-expired role when multiple grants exist", () => {
    const grants: ShareGrant[] = [
      shareGrant({ id: "g1", role: "viewer" }),
      shareGrant({ id: "g2", role: "editor" }),
    ];
    const r = decideAccess(grants, { kind: "calendar", id: "c1" }, { kind: "user", id: "u1" }, "write.update", NOW);
    expect(r.allowed).toBe(true);
    expect(r.effectiveRole).toBe("editor");
  });
});

describe("grant / revoke / pruneExpired", () => {
  it("grant appends a new entry", () => {
    const next = grant([], {
      resource: { kind: "event", id: "e1" },
      principal: { kind: "user", id: "u1" },
      role: "viewer",
      grantedBy: "owner",
    }, NOW);
    expect(next.length).toBe(1);
    expect(next[0].id).toMatch(/^g_/);
  });

  it("grant is idempotent on the same (resource, principal)", () => {
    const first = grant([], {
      resource: { kind: "event", id: "e1" },
      principal: { kind: "user", id: "u1" },
      role: "viewer",
      grantedBy: "owner",
    }, NOW);
    const second = grant(first, {
      resource: { kind: "event", id: "e1" },
      principal: { kind: "user", id: "u1" },
      role: "editor",
      grantedBy: "owner",
    }, NOW + 1);
    expect(second.length).toBe(1);
    expect(second[0].role).toBe("editor");
  });

  it("revoke drops the matching grant", () => {
    const grants = grant([], {
      resource: { kind: "event", id: "e1" },
      principal: { kind: "user", id: "u1" },
      role: "viewer",
      grantedBy: "owner",
    }, NOW);
    const id = grants[0].id;
    expect(revoke(grants, id).length).toBe(0);
    expect(revoke(grants, "unknown").length).toBe(1);
  });

  it("pruneExpired keeps only non-expired grants", () => {
    const grants: ShareGrant[] = [
      shareGrant({ id: "live" }),
      shareGrant({ id: "dead", expiresAt: new Date(NOW - 1000).toISOString() }),
    ];
    const out = pruneExpired(grants, NOW);
    expect(out.map((g) => g.id)).toEqual(["live"]);
  });
});

describe("createPublicLink", () => {
  it("produces a non-empty token", () => {
    const l = createPublicLink("viewer", "event", "e1");
    expect(l.token.length).toBeGreaterThan(0);
    expect(l.role).toBe("viewer");
    expect(l.expiresAt).toBeUndefined();
  });

  it("attaches an expiry when ttlHours is provided", () => {
    const l = createPublicLink("free-busy", "calendar", "c1", 24);
    expect(l.expiresAt).toBeTruthy();
  });
});

describe("ROLE_LABELS + ROLE_DESCRIPTIONS", () => {
  it("covers every share role", () => {
    const roles: ShareRole[] = ["owner", "editor", "commenter", "viewer", "free-busy"];
    for (const r of roles) {
      expect(ROLE_LABELS[r]).toBeTruthy();
      expect(ROLE_DESCRIPTIONS[r]).toBeTruthy();
    }
  });
});
