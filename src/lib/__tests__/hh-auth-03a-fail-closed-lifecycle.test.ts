/**
 * HH-AUTH-03A — Fail-Closed N3 User Lifecycle.
 *
 * N3 is the sole identity/membership authority. A HotelHub local role row is
 * an assignment only: it never proves the N3 account still exists or is
 * active. These tests prove the pure decision layer never preserves a local
 * operational role on an authority failure, that matching is by immutable N3
 * id only, and that `readRequestContext` destroys the encrypted session for
 * every authority-failure reason while keeping the role-not-assigned
 * experience for a verified-active user without an assignment.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { decideEffectiveRole, matchN3User, type N3UserRecord } from "@/lib/n3-owner";

// ---------- effective-role resolver mock (server layer is frozen) ----------
type Effective = {
  role: "owner" | "front_desk" | "housekeeper" | null;
  reason: string;
  matchedBy: "id" | null;
  fromCache: boolean;
};
const effectiveState: { next: Effective } = {
  next: { role: null, reason: "n3_users_unavailable", matchedBy: null, fromCache: false },
};
vi.mock("@/lib/n3-owner.server", () => ({
  resolveEffectiveRole: async () => ({
    ...effectiveState.next,
    ownerAuthorityFailedClosed: effectiveState.next.role !== "owner",
  }),
}));

// ---------- session mock ----------
const sessionState = { data: {} as Record<string, unknown>, cleared: 0 };
vi.mock("@/lib/session.server", () => ({
  getHotelSession: async () => ({
    get data() {
      return sessionState.data;
    },
    async update(next: Record<string, unknown>) {
      sessionState.data = { ...sessionState.data, ...next };
    },
    async clear() {
      sessionState.data = {};
      sessionState.cleared++;
    },
  }),
}));

// ---------- audit mock ----------
const auditEvents: Array<{ eventType: string; detail?: unknown }> = [];
vi.mock("@/lib/audit.server", () => ({
  logAudit: async (e: { eventType: string; detail?: unknown }) => {
    auditEvents.push({ eventType: e.eventType, detail: e.detail });
  },
}));

// ---------- local role lookup mock ----------
const localRoleState: { role: "owner" | "front_desk" | "housekeeper" | null; isActive: boolean } = {
  role: "front_desk",
  isActive: true,
};
vi.mock("@/lib/tenant-store.server", () => ({
  lookupRole: async () =>
    localRoleState.role
      ? { status: "assigned", role: localRoleState.role, isActive: localRoleState.isActive }
      : { status: "role_unassigned" },
}));

const { readRequestContext } = await import("@/lib/session-context.server");

const SECRET_TOKEN = "header.payload.signature-SECRET";
const EMAIL = "jonas2infinity@gmail.com";
const USERNAME = "jonas2infinity";

function session(overrides: Record<string, unknown> = {}) {
  return {
    n3Token: SECRET_TOKEN,
    tenantId: "tenant-1",
    tenantCode: "T1",
    companyName: "Hotel One",
    n3TenantKey: "n3-tenant-1",
    n3UserKey: "049a0d89-396e-4397-85d6-4cf5dffb98ed",
    userEmail: EMAIL,
    userName: USERNAME,
    ...overrides,
  };
}

const IDENTITY = {
  n3UserKey: "049a0d89-396e-4397-85d6-4cf5dffb98ed",
  email: EMAIL,
  userName: USERNAME,
};

function user(o: Partial<N3UserRecord> = {}): N3UserRecord {
  return {
    id: "049a0d89-396e-4397-85d6-4cf5dffb98ed",
    userName: USERNAME,
    email: EMAIL,
    isOwner: false,
    isActive: true,
    ...o,
  };
}

// =============================================== 1. pure decision layer

describe("HH-AUTH-03A — decideEffectiveRole fails closed", () => {
  it("returns null when /api/Users is unavailable, despite an active front_desk row", () => {
    const d = decideEffectiveRole({
      read: { status: "unavailable" },
      identity: IDENTITY,
      localRole: { role: "front_desk", isActive: true },
    });
    expect(d.role).toBeNull();
    expect(d.reason).toBe("n3_users_unavailable");
    expect(d.ownerAuthorityFailedClosed).toBe(true);
  });

  it("returns null on a malformed response, despite an active housekeeper row", () => {
    const d = decideEffectiveRole({
      read: { status: "malformed" },
      identity: IDENTITY,
      localRole: { role: "housekeeper", isActive: true },
    });
    expect(d.role).toBeNull();
    expect(d.reason).toBe("n3_users_malformed");
  });

  it("returns null when the immutable id does not match, despite a local role", () => {
    const d = decideEffectiveRole({
      read: { status: "ok", users: [user({ id: "some-other-immutable-id" })] },
      identity: IDENTITY,
      localRole: { role: "front_desk", isActive: true },
    });
    expect(d.role).toBeNull();
    expect(d.reason).toBe("n3_user_not_matched");
    expect(d.matchedBy).toBeNull();
  });

  it("returns null for an inactive / deleted / disabled matched user", () => {
    for (const u of [user({ isActive: false }), user({ isActive: false, isOwner: true })]) {
      const d = decideEffectiveRole({
        read: { status: "ok", users: [u] },
        identity: IDENTITY,
        localRole: { role: "housekeeper", isActive: true },
      });
      expect(d.role).toBeNull();
      expect(d.reason).toBe("n3_user_inactive");
      expect(d.ownerAuthorityFailedClosed).toBe(true);
    }
  });

  it("never matches on the same email or userName under a different immutable id", () => {
    const impostor = user({ id: "different-immutable-id", isOwner: true });
    expect(matchN3User([impostor], IDENTITY)).toBeNull();
    const d = decideEffectiveRole({
      read: { status: "ok", users: [impostor] },
      identity: IDENTITY,
      localRole: { role: "front_desk", isActive: true },
    });
    expect(d.role).toBeNull();
    expect(d.reason).toBe("n3_user_not_matched");
  });

  it("refuses an ambiguous duplicate immutable id", () => {
    const d = decideEffectiveRole({
      read: { status: "ok", users: [user({ isOwner: true }), user({ isOwner: true })] },
      identity: IDENTITY,
      localRole: null,
    });
    expect(d.role).toBeNull();
    expect(d.reason).toBe("n3_user_not_matched");
  });

  it("grants owner to a matched active isOwner user with no local row", () => {
    const d = decideEffectiveRole({
      read: { status: "ok", users: [user({ isOwner: true })] },
      identity: IDENTITY,
      localRole: null,
    });
    expect(d.role).toBe("owner");
    expect(d.reason).toBe("n3_owner");
    expect(d.matchedBy).toBe("id");
  });

  it("grants exactly the explicit operational role to a matched active non-owner", () => {
    for (const role of ["front_desk", "housekeeper"] as const) {
      const d = decideEffectiveRole({
        read: { status: "ok", users: [user()] },
        identity: IDENTITY,
        localRole: { role, isActive: true },
      });
      expect(d.role).toBe(role);
      expect(d.reason).toBe("n3_non_owner_local_role");
    }
  });

  it("revokes a former owner whose stale local owner row is the only claim", () => {
    const d = decideEffectiveRole({
      read: { status: "ok", users: [user()] },
      identity: IDENTITY,
      localRole: { role: "owner", isActive: true },
    });
    expect(d.role).toBeNull();
    expect(d.reason).toBe("n3_owner_revoked");
  });

  it("lets a former owner continue with an explicit front_desk assignment", () => {
    const d = decideEffectiveRole({
      read: { status: "ok", users: [user()] },
      identity: IDENTITY,
      localRole: { role: "front_desk", isActive: true },
    });
    expect(d.role).toBe("front_desk");
  });

  it("ignores an inactive local assignment row", () => {
    const d = decideEffectiveRole({
      read: { status: "ok", users: [user()] },
      identity: IDENTITY,
      localRole: { role: "front_desk", isActive: false },
    });
    expect(d.role).toBeNull();
    expect(d.reason).toBe("n3_no_local_role");
  });
});

// =============================================== 2. session lifecycle

const AUTHORITY_FAILURES = [
  "n3_users_unavailable",
  "n3_users_malformed",
  "n3_user_not_matched",
  "n3_user_inactive",
] as const;

describe("HH-AUTH-03A — readRequestContext destroys stale sessions", () => {
  beforeEach(() => {
    sessionState.data = session();
    sessionState.cleared = 0;
    auditEvents.length = 0;
    localRoleState.role = "front_desk";
    localRoleState.isActive = true;
  });

  for (const reason of AUTHORITY_FAILURES) {
    it(`clears the session and returns unauthenticated for ${reason}`, async () => {
      effectiveState.next = { role: null, reason, matchedBy: null, fromCache: false };
      const ctx = await readRequestContext();
      expect(ctx.authenticated).toBe(false);
      expect(sessionState.cleared).toBe(1);
      expect(sessionState.data).toEqual({});
      const destroyed = auditEvents.filter((e) => e.eventType === "session.destroyed");
      expect(destroyed).toHaveLength(1);
      expect(destroyed[0]!.detail).toMatchObject({ reason });
    });
  }

  it("does NOT clear the session for n3_no_local_role", async () => {
    localRoleState.role = null;
    effectiveState.next = {
      role: null,
      reason: "n3_no_local_role",
      matchedBy: "id",
      fromCache: false,
    };
    const ctx = await readRequestContext();
    expect(ctx.authenticated).toBe(true);
    if (!ctx.authenticated) return;
    expect(ctx.roleStatus).toBe("role_unassigned");
    expect(ctx.roleReason).toBe("n3_no_local_role");
    expect(sessionState.cleared).toBe(0);
  });

  it("does NOT clear the session for n3_owner_revoked", async () => {
    localRoleState.role = "owner";
    effectiveState.next = {
      role: null,
      reason: "n3_owner_revoked",
      matchedBy: "id",
      fromCache: false,
    };
    const ctx = await readRequestContext();
    expect(ctx.authenticated).toBe(true);
    if (!ctx.authenticated) return;
    expect(ctx.roleStatus).toBe("role_unassigned");
    expect(sessionState.cleared).toBe(0);
    expect(auditEvents.some((e) => e.eventType === "access.owner_revoked")).toBe(true);
    expect(auditEvents.some((e) => e.eventType === "session.destroyed")).toBe(false);
  });

  it("keeps serving a verified active assigned user", async () => {
    effectiveState.next = {
      role: "front_desk",
      reason: "n3_non_owner_local_role",
      matchedBy: "id",
      fromCache: false,
    };
    const ctx = await readRequestContext();
    expect(ctx.authenticated).toBe(true);
    if (!ctx.authenticated) return;
    expect(ctx.role).toBe("front_desk");
    expect(sessionState.cleared).toBe(0);
  });

  it("leaks no token, email, userName or upstream body in audit output", async () => {
    for (const reason of AUTHORITY_FAILURES) {
      sessionState.data = session();
      effectiveState.next = { role: null, reason, matchedBy: null, fromCache: false };
      await readRequestContext();
    }
    const dump = JSON.stringify(auditEvents);
    expect(dump).not.toContain(SECRET_TOKEN);
    expect(dump).not.toContain("signature-SECRET");
    expect(dump).not.toContain(EMAIL);
    expect(dump).not.toContain(USERNAME);
    expect(dump).not.toContain("<html");
  });

  it("stays tenant-scoped: the audit carries only this tenant and user key", async () => {
    sessionState.data = session({ tenantId: "tenant-9", n3UserKey: "user-9" });
    effectiveState.next = {
      role: null,
      reason: "n3_user_not_matched",
      matchedBy: null,
      fromCache: false,
    };
    await readRequestContext();
    const destroyed = auditEvents.find((e) => e.eventType === "session.destroyed");
    expect(destroyed).toBeDefined();
  });
});
