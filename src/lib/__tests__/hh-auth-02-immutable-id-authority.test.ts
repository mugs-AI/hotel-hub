/**
 * HH-AUTH-02 correction — User Control must authorize the actor ONLY by an
 * exact, unique, normalized match against the immutable `/api/Users` id.
 *
 * Proves that an actor whose session key differs from the immutable id, but
 * whose email / user name match the current N3 Owner, can neither list the
 * user directory nor assign / change / revoke anything, that no Supabase
 * write occurs on mismatch, that the exact-ID Owner still works, and that the
 * safe error output leaks no token, email, upstream body or raw error text.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { N3UserRecord, N3UsersRead } from "@/lib/n3-owner";
import { matchCurrentN3OwnerByImmutableId } from "@/lib/user-control";

// -------- audit mock --------
const auditEvents: Array<{ eventType: string; detail?: unknown }> = [];
vi.mock("@/lib/audit.server", () => ({
  logAudit: async (e: { eventType: string; detail?: unknown }) => {
    auditEvents.push({ eventType: e.eventType, detail: e.detail });
  },
}));

// -------- supabase admin mock that COUNTS every access --------
type Row = { tenant_id: string; n3_user_key: string; role: string; is_active: boolean };
const db = { rows: [] as Row[], reads: 0, writes: 0 };

function roleTable() {
  const filters: Record<string, string> = {};
  const chain = {
    select() {
      return chain;
    },
    eq(col: string, val: string) {
      filters[col] = val;
      return chain;
    },
    async maybeSingle() {
      db.reads += 1;
      const hit = db.rows.find(
        (r) => r.tenant_id === filters.tenant_id && r.n3_user_key === filters.n3_user_key,
      );
      return { data: hit ? { role: hit.role, is_active: hit.is_active } : null, error: null };
    },
    then(resolve: (v: unknown) => void) {
      db.reads += 1;
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
          db.writes += 1;
          db.rows = db.rows.filter(
            (r) => !(r.tenant_id === filters.tenant_id && r.n3_user_key === filters.n3_user_key),
          );
          return resolve({ error: null });
        },
      };
      return del;
    },
    async upsert(payload: Row) {
      db.writes += 1;
      const idx = db.rows.findIndex(
        (r) => r.tenant_id === payload.tenant_id && r.n3_user_key === payload.n3_user_key,
      );
      if (idx >= 0) db.rows[idx] = { ...payload };
      else db.rows.push({ ...payload });
      return { error: null };
    },
  };
  return chain;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: () => roleTable() },
}));

const { applyUserAccess, confirmActorIsCurrentN3Owner, listUserControl } =
  await import("@/lib/user-control.server");

function user(p: Partial<N3UserRecord> & { id: string }): N3UserRecord {
  return {
    id: p.id,
    userName: p.userName ?? null,
    email: p.email ?? null,
    isOwner: p.isOwner ?? false,
    isActive: p.isActive ?? true,
  };
}

const OWNER = user({
  id: "n3-immutable-owner-id",
  userName: "Theng",
  email: "owner@mugs.com.my",
  isOwner: true,
});
const ADMIN = user({ id: "u-admin", userName: "ADMIN", email: "ADMIN@MUGS.COM.MY" });

const TENANT = "tenant-1";
const SECRET_TOKEN = "n3-secret-token-value";
const UPSTREAM_BODY = "upstream stack trace: Users endpoint blew up";

const readOk = async (): Promise<N3UsersRead> => ({ status: "ok", users: [OWNER, ADMIN] });
const deps = { readUsers: readOk };

/** Same email + same user name as the Owner, but a DIFFERENT session key. */
const impostorIdentity = {
  n3UserKey: "jwt-sub-that-is-not-the-n3-id",
  email: "owner@mugs.com.my",
  userName: "Theng",
};
const ownerIdentity = {
  n3UserKey: "n3-immutable-owner-id",
  email: "owner@mugs.com.my",
  userName: "Theng",
};

beforeEach(() => {
  db.rows = [];
  db.reads = 0;
  db.writes = 0;
  auditEvents.length = 0;
});

describe("pure strict matcher", () => {
  it("only accepts a unique exact normalized immutable-id match", () => {
    expect(matchCurrentN3OwnerByImmutableId([OWNER, ADMIN], "n3-immutable-owner-id").ok).toBe(true);
    // case/whitespace normalization is still exact on the identifier itself
    expect(matchCurrentN3OwnerByImmutableId([OWNER, ADMIN], "  N3-IMMUTABLE-OWNER-ID ").ok).toBe(
      true,
    );
  });

  it("rejects email, user name, ambiguity, inactivity, non-owner and junk", () => {
    for (const key of [
      "owner@mugs.com.my",
      "Theng",
      "u-admin",
      "",
      "   ",
      null,
      undefined,
      42,
      "x".repeat(500),
    ]) {
      const res = matchCurrentN3OwnerByImmutableId([OWNER, ADMIN], key);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe("owner_check_failed");
    }
    const dup = [OWNER, user({ id: "n3-immutable-owner-id", isOwner: true })];
    expect(matchCurrentN3OwnerByImmutableId(dup, "n3-immutable-owner-id").ok).toBe(false);
    const inactiveOwner = [user({ id: "o", isOwner: true, isActive: false })];
    expect(matchCurrentN3OwnerByImmutableId(inactiveOwner, "o").ok).toBe(false);
  });
});

describe("listing is denied on immutable-id mismatch", () => {
  it("same email/username but different session key cannot list User Control", async () => {
    const res = await listUserControl(
      { token: SECRET_TOKEN, tenantId: TENANT, actorN3UserKey: impostorIdentity.n3UserKey },
      deps,
    );
    expect(res.status).toBe("owner_check_failed");
    // no directory returned at all
    expect(JSON.stringify(res)).not.toContain("ADMIN@MUGS.COM.MY");
    expect(JSON.stringify(res)).not.toContain("owner@mugs.com.my");
    // and no local role table access happened
    expect(db.reads).toBe(0);
    expect(db.writes).toBe(0);
  });

  it("exact immutable-id Owner still lists the directory", async () => {
    const res = await listUserControl(
      { token: SECRET_TOKEN, tenantId: TENANT, actorN3UserKey: ownerIdentity.n3UserKey },
      deps,
    );
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.rows.map((r) => r.n3UserKey)).toEqual(["n3-immutable-owner-id", "u-admin"]);
  });
});

describe("writes are denied on immutable-id mismatch", () => {
  it("same email/username but different id cannot assign, change or revoke", async () => {
    for (const access of ["front_desk", "housekeeper", "none"] as const) {
      const res = await applyUserAccess(
        {
          tenantId: TENANT,
          actorN3UserKey: impostorIdentity.n3UserKey,
          actorIdentity: impostorIdentity,
          token: SECRET_TOKEN,
          targetN3UserKey: "u-admin",
          access,
        },
        deps,
      );
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.status).toBe(403);
        expect(res.code).toBe("owner_check_failed");
      }
    }
    expect(db.writes).toBe(0);
    expect(db.rows).toHaveLength(0);
    expect(auditEvents).toHaveLength(0);
  });

  it("exact immutable-id Owner can assign, change and revoke", async () => {
    const base = {
      tenantId: TENANT,
      actorN3UserKey: ownerIdentity.n3UserKey,
      actorIdentity: ownerIdentity,
      token: SECRET_TOKEN,
      targetN3UserKey: "u-admin",
    };
    const grant = await applyUserAccess({ ...base, access: "front_desk" }, deps);
    expect(grant.ok).toBe(true);
    expect(db.rows[0]).toMatchObject({ n3_user_key: "u-admin", role: "front_desk" });

    const change = await applyUserAccess({ ...base, access: "housekeeper" }, deps);
    expect(change.ok).toBe(true);
    expect(db.rows[0]).toMatchObject({ role: "housekeeper" });

    const revoke = await applyUserAccess({ ...base, access: "none" }, deps);
    expect(revoke.ok).toBe(true);
    expect(db.rows).toHaveLength(0);
  });
});

describe("confirmation and safe output", () => {
  it("confirmActorIsCurrentN3Owner never falls back to email or user name", async () => {
    const bad = await confirmActorIsCurrentN3Owner(
      { token: SECRET_TOKEN, identity: impostorIdentity },
      deps,
    );
    expect(bad).toEqual({ ok: false, code: "owner_check_failed" });
    const good = await confirmActorIsCurrentN3Owner(
      { token: SECRET_TOKEN, identity: ownerIdentity },
      deps,
    );
    expect(good.ok).toBe(true);
  });

  it("denial output leaks no token, email, upstream body or raw error", async () => {
    const failing = {
      readUsers: async (): Promise<N3UsersRead> => {
        throw new Error(UPSTREAM_BODY);
      },
    };
    const thrown = await confirmActorIsCurrentN3Owner(
      { token: SECRET_TOKEN, identity: ownerIdentity },
      { readUsers: async () => ({ status: "unavailable" }) },
    );
    expect(thrown).toEqual({ ok: false, code: "owner_check_failed" });
    await expect(
      confirmActorIsCurrentN3Owner({ token: SECRET_TOKEN, identity: ownerIdentity }, failing),
    ).rejects.toThrow();

    const denied = await listUserControl(
      { token: SECRET_TOKEN, tenantId: TENANT, actorN3UserKey: impostorIdentity.n3UserKey },
      deps,
    );
    const serialized = JSON.stringify(denied);
    expect(serialized).not.toContain(SECRET_TOKEN);
    expect(serialized).not.toContain(UPSTREAM_BODY);
    expect(serialized).not.toContain("@mugs.com.my");
    expect(serialized).toBe(JSON.stringify({ status: "owner_check_failed" }));
  });
});
