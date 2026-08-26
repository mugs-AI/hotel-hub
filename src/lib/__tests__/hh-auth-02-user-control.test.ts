/**
 * HH-AUTH-02 — Owner-managed individual N3 user access.
 *
 * Proves the decision layer and the server layer: listing, grant/change/
 * revoke, deny-by-default for non-owners, cross-tenant / forged input
 * rejection, immutable-identifier authorization, locked N3 Owner, stale local
 * owner rows granting nothing, cache invalidation, fail-closed upstream
 * failure and leak-free responses/audit.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { N3UserRecord, N3UsersRead } from "@/lib/n3-owner";
import { decideEffectiveRole } from "@/lib/n3-owner";
import { authorize } from "@/lib/rbac";
import {
  buildUserControlRows,
  statusForAssignmentRejection,
  validateAssignment,
  type LocalRoleRow,
} from "@/lib/user-control";

// -------- audit mock --------
const auditEvents: Array<{ eventType: string; detail?: unknown; n3UserKey?: string | null }> = [];
vi.mock("@/lib/audit.server", () => ({
  logAudit: async (e: { eventType: string; detail?: unknown; n3UserKey?: string | null }) => {
    auditEvents.push({ eventType: e.eventType, detail: e.detail, n3UserKey: e.n3UserKey });
  },
}));

// -------- supabase admin mock (tenant-scoped role table) --------
type Row = { tenant_id: string; n3_user_key: string; role: string; is_active: boolean };
const db = { rows: [] as Row[], failRead: false, failWrite: false };

function roleTable() {
  const filters: Record<string, string> = {};
  const api: Record<string, unknown> = {};
  const chain = {
    select() {
      return chain;
    },
    eq(col: string, val: string) {
      filters[col] = val;
      return chain;
    },
    async maybeSingle() {
      if (db.failRead) return { data: null, error: { message: "x" } };
      const hit = db.rows.find(
        (r) => r.tenant_id === filters.tenant_id && r.n3_user_key === filters.n3_user_key,
      );
      return { data: hit ? { role: hit.role, is_active: hit.is_active } : null, error: null };
    },
    then(resolve: (v: unknown) => void) {
      if (db.failRead) return resolve({ data: null, error: { message: "x" } });
      const rows = db.rows
        .filter((r) => r.tenant_id === filters.tenant_id)
        .map((r) => ({ n3_user_key: r.n3_user_key, role: r.role, is_active: r.is_active }));
      return resolve({ data: rows, error: null });
    },
    delete() {
      const del = {
        eq(col: string, val: string) {
          filters[col] = val;
          return del;
        },
        then(resolve: (v: unknown) => void) {
          if (db.failWrite) return resolve({ error: { message: "x" } });
          db.rows = db.rows.filter(
            (r) => !(r.tenant_id === filters.tenant_id && r.n3_user_key === filters.n3_user_key),
          );
          return resolve({ error: null });
        },
      };
      return del;
    },
    async upsert(payload: Row) {
      if (db.failWrite) return { error: { message: "x" } };
      const idx = db.rows.findIndex(
        (r) => r.tenant_id === payload.tenant_id && r.n3_user_key === payload.n3_user_key,
      );
      if (idx >= 0) db.rows[idx] = { ...payload };
      else db.rows.push({ ...payload });
      return { error: null };
    },
  };
  Object.assign(api, chain);
  return chain;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: () => roleTable() },
}));

const { applyUserAccess, confirmActorIsCurrentN3Owner, listUserControl } =
  await import("@/lib/user-control.server");
const { invalidateOwnershipCacheForUser, resolveEffectiveRole, __resetOwnershipCache } =
  await import("@/lib/n3-owner.server");

function user(p: Partial<N3UserRecord> & { id: string }): N3UserRecord {
  return {
    id: p.id,
    userName: p.userName ?? null,
    email: p.email ?? null,
    isOwner: p.isOwner ?? false,
    isActive: p.isActive ?? true,
  };
}

const OWNER = user({ id: "u-owner", userName: "Theng", email: "owner@mugs.com.my", isOwner: true });
const ADMIN = user({ id: "u-admin", userName: "ADMIN", email: "ADMIN@MUGS.COM.MY" });
const CLEANER = user({ id: "u-clean", userName: "Cleaner", email: "clean@mugs.com.my" });
const RETIRED = user({ id: "u-old", userName: "Old", email: "old@mugs.com.my", isActive: false });

const TENANT = "tenant-1";
const OTHER_TENANT = "tenant-2";

const readOk = async (): Promise<N3UsersRead> => ({
  status: "ok",
  users: [OWNER, ADMIN, CLEANER, RETIRED],
});

const SECRET_TOKEN = "n3-secret-token-value";

const ownerIdentity = { n3UserKey: "u-owner", email: "owner@mugs.com.my", userName: "Theng" };

function deps(read: () => Promise<N3UsersRead> = readOk) {
  return { readUsers: read };
}

beforeEach(() => {
  db.rows = [];
  db.failRead = false;
  db.failWrite = false;
  auditEvents.length = 0;
  __resetOwnershipCache();
});

describe("listing", () => {
  it("the current N3 Owner can list the tenant's active N3 users", async () => {
    const res = await listUserControl(
      { token: SECRET_TOKEN, tenantId: TENANT, actorN3UserKey: "u-owner" },
      deps(),
    );
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    // inactive N3 users are not access subjects
    expect(res.rows.map((r) => r.n3UserKey)).toEqual(["u-owner", "u-admin", "u-clean"]);
    expect(res.rows[0]!.isCurrentN3Owner).toBe(true);
    expect(res.rows[0]!.manageable).toBe(false);
    expect(res.rows[0]!.access).toBe("owner");
    // recognition fields are present, the key is the immutable identifier
    expect(res.rows[1]!.email).toBe("ADMIN@MUGS.COM.MY");
  });

  it("is fail-closed and safe when /api/Users is unavailable or malformed", async () => {
    const un = await listUserControl(
      { token: SECRET_TOKEN, tenantId: TENANT, actorN3UserKey: "u-owner" },
      deps(async () => ({ status: "unavailable" })),
    );
    expect(un.status).toBe("upstream_unavailable");
    const mal = await listUserControl(
      { token: SECRET_TOKEN, tenantId: TENANT, actorN3UserKey: "u-owner" },
      deps(async () => ({ status: "malformed" })),
    );
    expect(mal.status).toBe("upstream_malformed");
    expect(JSON.stringify(un) + JSON.stringify(mal)).not.toContain(SECRET_TOKEN);
  });

  it("only reads local rows for the caller's own tenant", async () => {
    db.rows.push({
      tenant_id: OTHER_TENANT,
      n3_user_key: "u-admin",
      role: "front_desk",
      is_active: true,
    });
    const res = await listUserControl(
      { token: SECRET_TOKEN, tenantId: TENANT, actorN3UserKey: "u-owner" },
      deps(),
    );
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.rows.find((r) => r.n3UserKey === "u-admin")!.access).toBe("none");
  });

  it("hides users without a stable identifier instead of keying them by email", () => {
    const built = buildUserControlRows({
      users: [OWNER, { ...ADMIN, id: null }],
      localRoles: [],
    });
    expect(built.skippedWithoutIdentifier).toBe(1);
    expect(built.rows).toHaveLength(1);
  });

  it("shows a stale local owner row as granting nothing", () => {
    const local: LocalRoleRow[] = [{ n3UserKey: "u-admin", role: "owner", isActive: true }];
    const built = buildUserControlRows({ users: [OWNER, ADMIN], localRoles: local });
    const row = built.rows.find((r) => r.n3UserKey === "u-admin")!;
    expect(row.access).toBe("none");
    expect(row.staleLocalRole).toBe("owner");
    // and the effective resolver agrees
    expect(
      decideEffectiveRole({
        read: { status: "ok", users: [OWNER, ADMIN] },
        identity: { n3UserKey: "u-admin", email: null, userName: null },
        localRole: { role: "owner", isActive: true },
      }).role,
    ).toBeNull();
  });
});

describe("assignment", () => {
  const base = {
    tenantId: TENANT,
    actorN3UserKey: "u-owner",
    actorIdentity: ownerIdentity,
    token: SECRET_TOKEN,
  };

  it("grants Front Desk, changes to Housekeeper, then revokes to No access", async () => {
    const grant = await applyUserAccess(
      { ...base, targetN3UserKey: "u-admin", access: "front_desk" },
      deps(),
    );
    expect(grant).toMatchObject({ ok: true, from: "none", to: "front_desk", changed: true });
    expect(db.rows).toEqual([
      { tenant_id: TENANT, n3_user_key: "u-admin", role: "front_desk", is_active: true },
    ]);

    const change = await applyUserAccess(
      { ...base, targetN3UserKey: "u-admin", access: "housekeeper" },
      deps(),
    );
    expect(change).toMatchObject({ ok: true, from: "front_desk", to: "housekeeper" });

    const revoke = await applyUserAccess(
      { ...base, targetN3UserKey: "u-admin", access: "none" },
      deps(),
    );
    expect(revoke).toMatchObject({ ok: true, from: "housekeeper", to: "none" });
    expect(db.rows).toEqual([]);

    expect(auditEvents.map((e) => e.eventType)).toEqual([
      "role.assigned",
      "role.assigned",
      "role.revoked",
    ]);
    const dump = JSON.stringify(auditEvents);
    expect(dump).not.toContain("MUGS.COM.MY");
    expect(dump).not.toContain(SECRET_TOKEN);
    expect(auditEvents[0]!.detail).toEqual({
      target: "u-admin",
      from: "none",
      to: "front_desk",
      changed: true,
    });
  });

  it("revocation leaves the user at the existing role-not-assigned outcome", async () => {
    await applyUserAccess({ ...base, targetN3UserKey: "u-admin", access: "front_desk" }, deps());
    await applyUserAccess({ ...base, targetN3UserKey: "u-admin", access: "none" }, deps());
    const decision = decideEffectiveRole({
      read: { status: "ok", users: [OWNER, ADMIN] },
      identity: { n3UserKey: "u-admin", email: null, userName: null },
      localRole: null,
    });
    expect(decision.role).toBeNull();
    expect(decision.reason).toBe("n3_no_local_role");
  });

  it("authorization survives an email change because n3_user_key is the key", async () => {
    await applyUserAccess({ ...base, targetN3UserKey: "u-admin", access: "front_desk" }, deps());
    const renamed = { ...ADMIN, email: "admin.new@mugs.com.my" };
    const decision = decideEffectiveRole({
      read: { status: "ok", users: [OWNER, renamed] },
      identity: { n3UserKey: "u-admin", email: "admin.new@mugs.com.my", userName: "ADMIN" },
      localRole: { role: "front_desk", isActive: true },
    });
    expect(decision.role).toBe("front_desk");
    expect(db.rows[0]!.n3_user_key).toBe("u-admin");
  });

  it("rejects the current N3 Owner, self, owner grants, unknown, inactive and malformed targets", async () => {
    const cases: Array<[unknown, unknown, string, number]> = [
      ["u-owner", "front_desk", "target_is_owner", 403],
      ["u-owner", "none", "target_is_owner", 403],
      ["u-admin", "owner", "owner_not_assignable", 403],
      ["u-nobody", "front_desk", "unknown_target", 404],
      ["u-old", "front_desk", "target_inactive", 409],
      ["", "front_desk", "invalid_target", 400],
      [42, "front_desk", "invalid_target", 400],
      ["u-admin", "manager", "invalid_role", 400],
      ["u-admin", null, "invalid_role", 400],
    ];
    for (const [target, access, code, status] of cases) {
      const res = await applyUserAccess({ ...base, targetN3UserKey: target, access }, deps());
      expect(res).toMatchObject({ ok: false, code, status });
    }
    // self-modification, using the owner's own key as an ordinary actor
    const selfCase = validateAssignment({
      targetN3UserKey: "u-admin",
      access: "none",
      users: [OWNER, ADMIN],
      actorN3UserKey: "u-admin",
    });
    expect(selfCase).toEqual({ ok: false, code: "target_is_self" });
    expect(db.rows).toEqual([]);
  });

  it("rejects an ambiguous target rather than granting", () => {
    const dup = validateAssignment({
      targetN3UserKey: "u-admin",
      access: "front_desk",
      users: [ADMIN, { ...ADMIN, email: "other@x" }],
      actorN3UserKey: "u-owner",
    });
    expect(dup).toEqual({ ok: false, code: "unknown_target" });
  });

  it("never writes owner into hotel_user_roles", async () => {
    await applyUserAccess({ ...base, targetN3UserKey: "u-admin", access: "owner" }, deps());
    await applyUserAccess({ ...base, targetN3UserKey: "u-admin", access: "front_desk" }, deps());
    expect(db.rows.every((r) => r.role !== "owner")).toBe(true);
  });

  it("fails closed when the fresh N3 owner check cannot be made", async () => {
    const res = await applyUserAccess(
      { ...base, targetN3UserKey: "u-admin", access: "front_desk" },
      deps(async () => ({ status: "unavailable" })),
    );
    expect(res).toMatchObject({ ok: false, code: "owner_check_failed", status: 403 });
    expect(db.rows).toEqual([]);
  });

  it("a stale local owner row does not authorise a write; only the live N3 owner does", async () => {
    db.rows.push({
      tenant_id: TENANT,
      n3_user_key: "u-admin",
      role: "owner",
      is_active: true,
    });
    const stale = await applyUserAccess(
      {
        ...base,
        actorN3UserKey: "u-admin",
        actorIdentity: { n3UserKey: "u-admin", email: null, userName: null },
        targetN3UserKey: "u-clean",
        access: "front_desk",
      },
      deps(),
    );
    expect(stale).toMatchObject({ ok: false, code: "owner_check_failed" });
    // the real owner still can
    const ok = await applyUserAccess(
      { ...base, targetN3UserKey: "u-clean", access: "front_desk" },
      deps(),
    );
    expect(ok.ok).toBe(true);
  });

  it("surfaces a safe code and writes nothing when the store fails", async () => {
    db.failWrite = true;
    const res = await applyUserAccess(
      { ...base, targetN3UserKey: "u-admin", access: "front_desk" },
      deps(),
    );
    expect(res).toMatchObject({ ok: false, code: "store_unavailable", status: 503 });
    expect(JSON.stringify(res)).not.toContain("x");
  });

  it("maps every rejection to a deny-by-default status", () => {
    expect(statusForAssignmentRejection("invalid_target")).toBe(400);
    expect(statusForAssignmentRejection("unknown_target")).toBe(404);
    expect(statusForAssignmentRejection("target_inactive")).toBe(409);
    expect(statusForAssignmentRejection("target_is_owner")).toBe(403);
  });
});

describe("permission boundary", () => {
  it("only owner holds roles:manage", () => {
    for (const role of ["front_desk", "housekeeper"] as const) {
      expect(authorize({ hasSession: true, tenantId: TENANT, role }, "roles:manage").ok).toBe(
        false,
      );
    }
    expect(authorize({ hasSession: true, tenantId: TENANT, role: null }, "roles:manage").ok).toBe(
      false,
    );
    expect(authorize({ hasSession: false, tenantId: null, role: null }, "roles:manage").ok).toBe(
      false,
    );
    expect(
      authorize({ hasSession: true, tenantId: TENANT, role: "owner" }, "roles:manage").ok,
    ).toBe(true);
  });

  it("confirmActorIsCurrentN3Owner ignores local rows entirely", async () => {
    const nonOwner = await confirmActorIsCurrentN3Owner(
      { token: SECRET_TOKEN, identity: { n3UserKey: "u-admin", email: null, userName: null } },
      deps(),
    );
    expect(nonOwner).toEqual({ ok: false, code: "owner_check_failed" });
  });
});

describe("cache invalidation", () => {
  it("a change is observed on the next authorization decision", async () => {
    const read = async (): Promise<N3UsersRead> => ({ status: "ok", users: [OWNER, ADMIN] });
    const identity = { n3UserKey: "u-admin", email: null, userName: null };

    const first = await resolveEffectiveRole({
      token: SECRET_TOKEN,
      tenantId: TENANT,
      identity,
      localRole: null,
      readUsers: read,
    });
    expect(first.role).toBeNull();

    await applyUserAccess(
      {
        tenantId: TENANT,
        actorN3UserKey: "u-owner",
        actorIdentity: ownerIdentity,
        token: SECRET_TOKEN,
        targetN3UserKey: "u-admin",
        access: "front_desk",
      },
      { readUsers: read },
    );

    const after = await resolveEffectiveRole({
      token: SECRET_TOKEN,
      tenantId: TENANT,
      identity,
      localRole: { role: "front_desk", isActive: true },
      readUsers: read,
    });
    expect(after.role).toBe("front_desk");
    expect(after.fromCache).toBe(false);
  });

  it("invalidation is scoped to the exact tenant + user", async () => {
    const read = async (): Promise<N3UsersRead> => ({ status: "ok", users: [OWNER, ADMIN] });
    await resolveEffectiveRole({
      token: SECRET_TOKEN,
      tenantId: TENANT,
      identity: { n3UserKey: "u-admin", email: null, userName: null },
      localRole: null,
      readUsers: read,
    });
    expect(invalidateOwnershipCacheForUser(OTHER_TENANT, "u-admin")).toBe(0);
    expect(invalidateOwnershipCacheForUser(TENANT, "u-admin")).toBe(1);
  });
});
