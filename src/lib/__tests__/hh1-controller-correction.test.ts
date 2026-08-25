/**
 * HH1.0 stabilization pass — controller audit correction.
 *
 * 1. `/api/Users` envelope handling matches real N3 shapes.
 * 2. Ownership lookup single-flights and is time-bounded (no request storm,
 *    no long app stall), failing closed.
 * 3. Role-unassigned UI never tells a revoked ex-Owner to provision Owner.
 * 4. DND evidence is RENDERED, not source text.
 * 5. Double-submit / overlapping room actions are guarded synchronously.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, beforeEach } from "vitest";

import {
  decideEffectiveRole,
  extractN3Users,
  unwrapN3Array,
  type N3UsersRead,
} from "@/lib/n3-owner";
import {
  __inFlightOwnershipCount,
  __resetOwnershipCache,
  ownershipCacheKey,
  resolveEffectiveRole,
  OWNERSHIP_UPSTREAM_TIMEOUT_MS,
} from "@/lib/n3-owner.server";
import { roleUnassignedGuidance } from "@/lib/role-unassigned";
import { createRoomActionGuard, runGuardedRoomAction } from "@/lib/room-action-guard";
import { RoomCard } from "@/components/HousekeepingBoard";
import { RoleUnassignedShell } from "@/components/AppShell";
import {
  DND_SETUP_HINT_SHORT,
  DND_CLEANING_HINT_SHORT,
  DND_SET_LABEL,
} from "@/lib/housekeeping";
import type { HousekeepingRoomDTO } from "@/lib/housekeeping-store.server";
import type { SessionMe } from "@/lib/session-client";

const IDENTITY = { n3UserKey: "u-1", email: "Owner@Hotel.test", userName: "owner1" };

// ---------------------------------------------------------------- 1. envelopes

describe("1 — /api/Users envelope handling", () => {
  const owner = { userId: "u-1", userName: "owner1", isOwner: true, isActive: true };

  it("accepts a bare top-level array", () => {
    expect(extractN3Users([owner]).status).toBe("ok");
  });

  it("accepts the official { code, data: { value, count } } envelope", () => {
    const read = extractN3Users({ code: "0000", data: { value: [owner], count: 1 } });
    expect(read.status).toBe("ok");
    if (read.status === "ok") expect(read.users[0]!.id).toBe("u-1");
  });

  it("accepts PascalCase { Code, Data: { Value } }", () => {
    const read = extractN3Users({
      Code: "0000",
      Data: { Value: [{ UserId: "u-1", UserName: "owner1", IsOwner: true, IsActive: true }] },
    });
    expect(read.status).toBe("ok");
    if (read.status === "ok") expect(read.users[0]!.isOwner).toBe(true);
  });

  it("accepts data as an array, data.items, data.data and top-level value/items", () => {
    for (const body of [
      { code: "0000", data: [owner] },
      { code: "0000", data: { items: [owner] } },
      { code: "0000", data: { Items: [owner] } },
      { code: "0000", data: { data: [owner] } },
      { value: [owner] },
      { Value: [owner] },
      { items: [owner] },
      { Items: [owner] },
    ]) {
      expect(extractN3Users(body).status).toBe("ok");
    }
  });

  it("normalizes the official UserDto userId as the stable identity", () => {
    const read = extractN3Users({ code: "0000", data: { value: [owner] } });
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;
    const d = decideEffectiveRole({
      read,
      identity: IDENTITY,
      localRole: { role: "owner", isActive: true },
    });
    expect(d.matchedBy).toBe("id");
    expect(d.role).toBe("owner");
  });

  it("REFUSES a non-0000 envelope even when it contains an array of owners", () => {
    const read = extractN3Users({ code: "9999", data: { value: [owner] } });
    expect(read.status).toBe("unavailable");
    expect(unwrapN3Array({ Code: "0001", data: [owner] }).status).toBe("non_success");
    const d = decideEffectiveRole({
      read,
      identity: IDENTITY,
      localRole: { role: "owner", isActive: true },
    });
    expect(d.role).not.toBe("owner");
    expect(d.ownerAuthorityFailedClosed).toBe(true);
  });

  it("refuses empty and malformed bodies", () => {
    expect(extractN3Users({ code: "0000", data: { value: [] } }).status).toBe("malformed");
    expect(extractN3Users({ code: "0000", data: { value: ["nope", 3] } }).status).toBe("malformed");
    expect(extractN3Users(null).status).toBe("malformed");
    expect(extractN3Users("<html/>").status).toBe("malformed");
    expect(extractN3Users({ code: "0000" }).status).toBe("malformed");
  });

  it("rejects an ambiguous identity match instead of granting authority", () => {
    const read = extractN3Users({
      code: "0000",
      data: {
        value: [
          { email: "owner@hotel.test", isOwner: true, isActive: true },
          { email: "OWNER@HOTEL.TEST", isOwner: true, isActive: true },
        ],
      },
    });
    const d = decideEffectiveRole({
      read,
      identity: IDENTITY,
      localRole: { role: "owner", isActive: true },
    });
    expect(d.reason).toBe("n3_user_not_matched");
    expect(d.role).not.toBe("owner");
  });

  it("prefers the stable id over a conflicting email row", () => {
    const read = extractN3Users({
      code: "0000",
      data: {
        value: [
          { userId: "u-1", email: "someone.else@hotel.test", isOwner: false, isActive: true },
          { userId: "u-2", email: "owner@hotel.test", isOwner: true, isActive: true },
        ],
      },
    });
    const d = decideEffectiveRole({
      read,
      identity: IDENTITY,
      localRole: { role: "owner", isActive: true },
    });
    expect(d.matchedBy).toBe("id");
    expect(d.reason).toBe("n3_owner_revoked");
  });
});

// ------------------------------------------------- 2. single flight + timeout

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const OWNER_READ: N3UsersRead = {
  status: "ok",
  users: [{ id: "u-1", userName: null, email: null, isOwner: true, isActive: true }],
};

describe("2 — ownership lookup never storms N3 and never stalls the app", () => {
  beforeEach(() => __resetOwnershipCache());

  it("bounds the ownership-specific upstream wait to 3 seconds", () => {
    expect(OWNERSHIP_UPSTREAM_TIMEOUT_MS).toBe(3_000);
  });

  it("de-duplicates concurrent misses for the same key into ONE upstream read", async () => {
    let reads = 0;
    const gate = deferred<N3UsersRead>();
    const readUsers = async () => {
      reads++;
      return gate.promise;
    };
    const input = {
      token: "tok",
      tenantId: "t1",
      identity: IDENTITY,
      localRole: { role: "owner" as const, isActive: true },
      readUsers,
      now: 1_000,
    };
    const all = Promise.all([
      resolveEffectiveRole(input),
      resolveEffectiveRole(input),
      resolveEffectiveRole(input),
    ]);
    await Promise.resolve();
    expect(__inFlightOwnershipCount()).toBe(1);
    gate.resolve(OWNER_READ);
    const results = await all;
    expect(reads).toBe(1);
    for (const r of results) expect(r.role).toBe("owner");
    expect(__inFlightOwnershipCount()).toBe(0);
  });

  it("never shares an in-flight read across tenants, users or rotated tokens", async () => {
    let reads = 0;
    const readUsers = async () => {
      reads++;
      return OWNER_READ;
    };
    const base = {
      identity: IDENTITY,
      localRole: { role: "owner" as const, isActive: true },
      readUsers,
      now: 2_000,
    };
    await Promise.all([
      resolveEffectiveRole({ ...base, token: "a", tenantId: "t1" }),
      resolveEffectiveRole({ ...base, token: "b", tenantId: "t1" }),
      resolveEffectiveRole({ ...base, token: "a", tenantId: "t2" }),
      resolveEffectiveRole({
        ...base,
        token: "a",
        tenantId: "t1",
        identity: { ...IDENTITY, n3UserKey: "u-2" },
      }),
    ]);
    expect(reads).toBe(4);
  });

  it("clears the in-flight entry when the upstream read fails, and fails closed", async () => {
    const boom = async (): Promise<N3UsersRead> => {
      throw new Error("upstream exploded");
    };
    const input = {
      token: "tok",
      tenantId: "t1",
      identity: IDENTITY,
      localRole: { role: "owner" as const, isActive: true },
      readUsers: boom,
      now: 3_000,
    };
    await expect(resolveEffectiveRole(input)).rejects.toThrow();
    expect(__inFlightOwnershipCount()).toBe(0);

    // The next attempt is free to re-read; a timeout collapses to unavailable
    // and Owner is refused despite the stale local owner row.
    const timedOut = await resolveEffectiveRole({
      ...input,
      readUsers: async () => ({ status: "unavailable" }),
      now: 3_001,
    });
    expect(timedOut.role).not.toBe("owner");
    expect(timedOut.reason).toBe("n3_users_unavailable");
    expect(timedOut.ownerAuthorityFailedClosed).toBe(true);
  });

  it("enforces revocation no later than the 60s cache window, and never stores the token", async () => {
    let owner = true;
    const readUsers = async (): Promise<N3UsersRead> => ({
      status: "ok",
      users: [{ id: "u-1", userName: null, email: null, isOwner: owner, isActive: true }],
    });
    const input = {
      token: "super-secret-jwt",
      tenantId: "t1",
      identity: IDENTITY,
      localRole: { role: "owner" as const, isActive: true },
      readUsers,
    };
    const t0 = 5_000_000;
    expect((await resolveEffectiveRole({ ...input, now: t0 })).role).toBe("owner");
    owner = false;
    expect((await resolveEffectiveRole({ ...input, now: t0 + 59_000 })).role).toBe("owner");
    const after = await resolveEffectiveRole({ ...input, now: t0 + 60_001 });
    expect(after.role).not.toBe("owner");

    const key = ownershipCacheKey({ token: "super-secret-jwt", tenantId: "t1", n3UserKey: "u-1" });
    expect(key).not.toContain("super-secret-jwt");
  });
});

// ------------------------------------------------------- 3. role-unassigned UI

function sessionFixture(roleReason: unknown) {
  return {
    authenticated: true,
    tenant: {
      tenantId: "tenant-1",
      tenantCode: "HOTEL",
      companyName: "Boutique Hotel",
      n3TenantKey: "n3-tenant",
    },
    user: { userEmail: "owner@hotel.test", userName: "owner1", n3UserKey: "u-1" },
    role: null,
    roleStatus: "role_unassigned",
    roleReason,
    housekeepingMode: "simple",
  } as Extract<SessionMe, { authenticated: true }>;
}

function renderGate(reason: unknown): string {
  return renderToStaticMarkup(
    createElement(RoleUnassignedShell, {
      session: sessionFixture(reason),
      onSignOut: () => {},
      signingOut: false,
      onRetry: () => {},
    }),
  );
}

const PROVISION_SQL = "hotelhub_provision_owner";

describe("3 — role-unassigned UI tells the truth for each reason", () => {
  it("a revoked ex-Owner is never told to provision Owner again", () => {
    const html = renderGate("n3_owner_revoked");
    expect(html).not.toContain(PROVISION_SQL);
    expect(html).toContain("N3 Owner permission was removed");
    expect(html).toMatch(/Owner-only actions are blocked/);
    expect(html).toMatch(/Front desk or Housekeeper/);
    expect(roleUnassignedGuidance("n3_owner_revoked").showProvisioning).toBe(false);
  });

  it("an unconfirmable ownership read offers retry, not provisioning", () => {
    for (const reason of ["n3_users_unavailable", "n3_users_malformed"] as const) {
      const html = renderGate(reason);
      expect(html).not.toContain(PROVISION_SQL);
      expect(html).toContain("Owner authority cannot be confirmed right now");
      expect(html).toContain("Try again");
    }
  });

  it("inactive and unmatched users are denied safely, without PII or N3 data", () => {
    const inactive = renderGate("n3_user_inactive");
    expect(inactive).toContain("not active");
    expect(inactive).not.toContain(PROVISION_SQL);
    expect(inactive).not.toContain("owner@hotel.test");
    const unmatched = renderGate("n3_user_not_matched");
    expect(unmatched).not.toContain(PROVISION_SQL);
    expect(unmatched).not.toContain("owner@hotel.test");
  });

  it("only the genuine bootstrap case shows the first-Owner runbook", () => {
    for (const reason of ["n3_no_local_role", null]) {
      const html = renderGate(reason);
      expect(html).toContain(PROVISION_SQL);
      expect(html).toContain("HotelHub role not assigned");
      expect(html).toContain("n3_user_key");
    }
  });
});

// --------------------------------------------------------- 4. rendered DND UI

function roomFixture(over: Partial<HousekeepingRoomDTO> = {}): HousekeepingRoomDTO {
  return {
    roomId: "r-1",
    roomLabel: "101 — Deluxe",
    roomNumber: "101",
    floor: "1",
    roomType: "Deluxe",
    maxOccupancy: 2,
    isActive: true,
    initialized: true,
    condition: "ready",
    dndActive: false,
    dndSetAt: null,
    lastAction: null,
    lastActorLabel: null,
    lastTransitionAt: null,
    occupancy: "occupied",
    occupancyReservationId: null,
    occupancyOverdue: false,
    group: "ready",
    nextStep: "Nothing to do.",
    availableTransitions: [],
    canSetDnd: false,
    canClearDnd: false,
    checkInBlockers: [],
    ...over,
  } as HousekeepingRoomDTO;
}

function renderRoom(room: HousekeepingRoomDTO, opts: { canDnd: boolean }): string {
  return renderToStaticMarkup(
    createElement(RoomCard, {
      room,
      variant: "dedicated",
      canUpdate: true,
      canDnd: opts.canDnd,
      canInitialize: true,
      busy: false,
      onTransition: () => {},
      onDnd: () => {},
      onInitialize: () => {},
    }),
  );
}

/** Count DND buttons and whether each is rendered disabled. */
function dndButtons(html: string): Array<{ disabled: boolean }> {
  const out: Array<{ disabled: boolean }> = [];
  const re = /<button\b[^>]*>(?:(?!<\/button>).)*?<\/button>/gs;
  for (const m of html.match(re) ?? []) {
    // React renders the boolean attribute as `disabled=""`; the Tailwind
    // `disabled:opacity-50` class must not be mistaken for it.
    if (m.includes(DND_SET_LABEL)) out.push({ disabled: /\sdisabled=""/.test(m) });
  }
  return out;
}

describe("4 — DND evidence is rendered, not source text", () => {
  it("occupied + not set up: a VISIBLE but disabled Set DND with the exact first step", () => {
    const html = renderRoom(
      roomFixture({ initialized: false, condition: null, occupancy: "occupied" }),
      { canDnd: true },
    );
    const buttons = dndButtons(html);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.disabled).toBe(true);
    expect(html).toContain(DND_SETUP_HINT_SHORT);
  });

  it("initialized, occupied and eligible: Set DND is rendered ENABLED", () => {
    const html = renderRoom(roomFixture({ canSetDnd: true, condition: "dirty" }), { canDnd: true });
    const buttons = dndButtons(html);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.disabled).toBe(false);
  });

  it("occupied + Cleaning: DND stays visible, disabled, and explains why", () => {
    const html = renderRoom(
      roomFixture({ condition: "cleaning", occupancy: "occupied", canSetDnd: false }),
      { canDnd: true },
    );
    const buttons = dndButtons(html);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.disabled).toBe(true);
    expect(html).toContain(DND_CLEANING_HINT_SHORT);
  });

  it("vacant room: no enabled DND control", () => {
    const html = renderRoom(
      roomFixture({ occupancy: "vacant", canSetDnd: false, condition: "ready" }),
      { canDnd: true },
    );
    expect(dndButtons(html).filter((b) => !b.disabled)).toHaveLength(0);
  });

  it("unauthorized role (canDnd=false): no DND control at all", () => {
    const html = renderRoom(roomFixture({ canSetDnd: true, condition: "dirty" }), {
      canDnd: false,
    });
    expect(dndButtons(html)).toHaveLength(0);
  });

  it("the server stays decisive: canSetDnd=false never renders an enabled Set DND", () => {
    const html = renderRoom(roomFixture({ canSetDnd: false, condition: "dirty" }), {
      canDnd: true,
    });
    expect(dndButtons(html).filter((b) => !b.disabled)).toHaveLength(0);
  });
});

// -------------------------------------------------- 5. double-submit behaviour

describe("5 — overlapping room actions are guarded synchronously", () => {
  it("a same-room double call in the same frame invokes ONE mutation", async () => {
    const guard = createRoomActionGuard();
    const gate = deferred<string>();
    let invocations = 0;
    const invoke = () => {
      invocations++;
      return gate.promise;
    };
    const first = runGuardedRoomAction({ guard, roomId: "r-1", invoke });
    const second = runGuardedRoomAction({ guard, roomId: "r-1", invoke });
    expect(await second).toBe(false);
    gate.resolve("ok");
    expect(await first).toBe(true);
    expect(invocations).toBe(1);
    expect(guard.has("r-1")).toBe(false);
  });

  it("two different rooms both run, and each clears only its own id out of order", async () => {
    const guard = createRoomActionGuard();
    const a = deferred<string>();
    const b = deferred<string>();
    const settled: string[] = [];
    const confirmations: string[] = [];

    const runA = runGuardedRoomAction({
      guard,
      roomId: "r-a",
      invoke: () => a.promise,
      onSuccess: (r) => confirmations.push(`a:${r}`),
      onSettled: (id) => settled.push(id),
    });
    const runB = runGuardedRoomAction({
      guard,
      roomId: "r-b",
      invoke: () => b.promise,
      onSuccess: (r) => confirmations.push(`b:${r}`),
      onSettled: (id) => settled.push(id),
    });
    expect(guard.size()).toBe(2);

    // B settles FIRST, out of order.
    b.resolve("done-b");
    await runB;
    expect(guard.has("r-b")).toBe(false);
    expect(guard.has("r-a")).toBe(true);

    a.resolve("done-a");
    await runA;
    expect(settled).toEqual(["r-b", "r-a"]);
    expect(confirmations).toEqual(["b:done-b", "a:done-a"]);
    expect(guard.size()).toBe(0);
  });

  it("a failing invocation produces its own error and still releases its id", async () => {
    const guard = createRoomActionGuard();
    let error: unknown = null;
    await runGuardedRoomAction({
      guard,
      roomId: "r-1",
      invoke: async () => {
        throw new Error("dnd_active");
      },
      onError: (e) => (error = e),
    });
    expect((error as Error).message).toBe("dnd_active");
    expect(guard.has("r-1")).toBe(false);
  });
});
