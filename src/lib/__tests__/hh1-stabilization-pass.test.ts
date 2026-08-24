/**
 * HH1.0 approved stabilization pass.
 *
 * P0 — N3 ownership revocation is server-authoritative.
 * P1 — housekeeping mode change is visible on first navigation.
 * P1 — Do Not Disturb is visible and explains the first step.
 * P1 — housekeeping response-time stabilization (parallel reads, patched
 *      cache, debounced resync, safe stage timings).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, beforeEach } from "vitest";

import {
  decideEffectiveRole,
  extractN3Users,
  normalizeIdentity,
  type N3UsersRead,
} from "@/lib/n3-owner";
import {
  __resetOwnershipCache,
  ownershipCacheKey,
  resolveEffectiveRole,
  N3_USERS_PATH,
} from "@/lib/n3-owner.server";
import { formatServerTiming, sanitizeTimingName, ServerTimings } from "@/lib/server-timing";
import { DND_SETUP_HINT, DND_CLEANING_HINT, DND_SET_LABEL } from "@/lib/housekeeping";

const read = (p: string) => readFileSync(p, "utf8");
const BOARD = read("src/components/HousekeepingBoard.tsx");
const CLIENT = read("src/lib/housekeeping-client.ts");
const STORE = read("src/lib/housekeeping-store.server.ts");
const CONTEXT = read("src/lib/session-context.server.ts");
const SETTINGS_UI = read("src/components/PropertySettingsPanels.tsx");
const BOARD_ROUTE = read("src/routes/api/hotel/housekeeping.ts");
const ROOM_ROUTE = read("src/routes/api/hotel/housekeeping.rooms.$roomId.ts");

const IDENTITY = { n3UserKey: "u-1", email: "Owner@Hotel.test", userName: "owner1" };

describe("P0 — N3 is the sole ownership authority", () => {
  it("uses only the official read-only /api/Users endpoint", () => {
    expect(N3_USERS_PATH).toBe("/api/Users");
  });

  it("grants Owner when N3 says the matched user is an active owner", () => {
    const d = decideEffectiveRole({
      read: {
        status: "ok",
        users: [{ id: "u-1", userName: "owner1", email: null, isOwner: true, isActive: true }],
      },
      identity: IDENTITY,
      localRole: { role: "owner", isActive: true },
    });
    expect(d.role).toBe("owner");
    expect(d.reason).toBe("n3_owner");
    expect(d.matchedBy).toBe("id");
  });

  it("REVOKES Owner immediately when N3 clears isOwner, despite a stale local owner row", () => {
    const d = decideEffectiveRole({
      read: {
        status: "ok",
        users: [{ id: "u-1", userName: "owner1", email: null, isOwner: false, isActive: true }],
      },
      identity: IDENTITY,
      localRole: { role: "owner", isActive: true },
    });
    expect(d.role).not.toBe("owner");
    expect(d.reason).toBe("n3_owner_revoked");
  });

  it("keeps a non-owner local role when N3 confirms an active non-owner user", () => {
    const d = decideEffectiveRole({
      read: {
        status: "ok",
        users: [{ id: "u-1", userName: null, email: null, isOwner: false, isActive: true }],
      },
      identity: IDENTITY,
      localRole: { role: "front_desk", isActive: true },
    });
    expect(d.role).toBe("front_desk");
  });

  it("fails CLOSED for Owner on every non-authoritative outcome", () => {
    const outcomes: N3UsersRead[] = [
      { status: "unavailable" },
      { status: "malformed" },
      { status: "ok", users: [] },
      {
        status: "ok",
        users: [{ id: "u-1", userName: null, email: null, isOwner: true, isActive: false }],
      },
    ];
    for (const r of outcomes) {
      const d = decideEffectiveRole({
        read: r,
        identity: IDENTITY,
        localRole: { role: "owner", isActive: true },
      });
      expect(d.role).not.toBe("owner");
      expect(d.ownerAuthorityFailedClosed).toBe(true);
    }
  });

  it("matches by email case-insensitively when no stable id is present", () => {
    expect(normalizeIdentity("  Owner@Hotel.TEST ")).toBe("owner@hotel.test");
    const d = decideEffectiveRole({
      read: {
        status: "ok",
        users: [
          { id: null, userName: null, email: "OWNER@hotel.test", isOwner: true, isActive: true },
        ],
      },
      identity: IDENTITY,
      localRole: { role: "owner", isActive: true },
    });
    expect(d.matchedBy).toBe("email");
    expect(d.role).toBe("owner");
  });

  it("reads PascalCase and camelCase N3 user payloads, and rejects junk", () => {
    const ok = extractN3Users([{ Id: "x", UserName: "u", IsOwner: true, IsActive: true }]);
    expect(ok.status).toBe("ok");
    expect(extractN3Users("nope").status).toBe("malformed");
  });
});

describe("P0 — ownership cache is scoped and credential-free", () => {
  beforeEach(() => __resetOwnershipCache());

  it("never stores the raw token in the cache key", () => {
    const key = ownershipCacheKey({ token: "secret-jwt", tenantId: "t1", n3UserKey: "u-1" });
    expect(key).not.toContain("secret-jwt");
    expect(key.startsWith("t1::u-1::")).toBe(true);
  });

  it("separates tenants, users and rotated tokens", () => {
    const base = { token: "a", tenantId: "t1", n3UserKey: "u-1" };
    expect(ownershipCacheKey(base)).not.toBe(ownershipCacheKey({ ...base, token: "b" }));
    expect(ownershipCacheKey(base)).not.toBe(ownershipCacheKey({ ...base, tenantId: "t2" }));
    expect(ownershipCacheKey(base)).not.toBe(ownershipCacheKey({ ...base, n3UserKey: "u-2" }));
  });

  it("serves a cached decision within the window, then re-reads N3 after it expires", async () => {
    let reads = 0;
    const readUsers = async (): Promise<N3UsersRead> => {
      reads++;
      return {
        status: "ok",
        users: [{ id: "u-1", userName: null, email: null, isOwner: true, isActive: true }],
      };
    };
    const input = {
      token: "tok",
      tenantId: "t1",
      identity: IDENTITY,
      localRole: { role: "owner" as const, isActive: true },
      readUsers,
    };
    const t0 = 1_000_000;
    const a = await resolveEffectiveRole({ ...input, now: t0 });
    const b = await resolveEffectiveRole({ ...input, now: t0 + 30_000 });
    const c = await resolveEffectiveRole({ ...input, now: t0 + 61_000 });
    expect(a.fromCache).toBe(false);
    expect(b.fromCache).toBe(true);
    expect(c.fromCache).toBe(false);
    expect(reads).toBe(2);
    expect(c.role).toBe("owner");
  });

  it("a later N3 revocation removes Owner once the cache window passes", async () => {
    let owner = true;
    const readUsers = async (): Promise<N3UsersRead> => ({
      status: "ok",
      users: [{ id: "u-1", userName: null, email: null, isOwner: owner, isActive: true }],
    });
    const input = {
      token: "tok",
      tenantId: "t1",
      identity: IDENTITY,
      localRole: { role: "owner" as const, isActive: true },
      readUsers,
    };
    const t0 = 2_000_000;
    expect((await resolveEffectiveRole({ ...input, now: t0 })).role).toBe("owner");
    owner = false;
    const after = await resolveEffectiveRole({ ...input, now: t0 + 61_000 });
    expect(after.role).not.toBe("owner");
    expect(after.reason).toBe("n3_owner_revoked");
  });
});

describe("P0 — the request context uses the effective role, not the local row", () => {
  it("resolves every request's role through resolveEffectiveRole", () => {
    expect(CONTEXT).toContain("resolveEffectiveRole");
    expect(CONTEXT).toContain("effective.role");
    // The local lookup is an assignment input only.
    expect(CONTEXT).toContain("localRole");
    // The local row is only ever passed IN as `localRole`; it is never
    // returned as the effective role of the request.
    expect(CONTEXT).not.toMatch(/\n\s+role: roleLookup\.role,/);
  });

  it("audits a revocation with reason codes only — no PII, no upstream payload", () => {
    expect(CONTEXT).toContain('eventType: "access.owner_revoked"');
    expect(CONTEXT).toContain("reason: effective.reason");
    expect(CONTEXT).not.toMatch(/detail: \{[^}]*email/);
  });

  it("does not re-audit on cache hits", () => {
    expect(CONTEXT).toContain("!effective.fromCache");
  });
});

describe("P1 — mode change reflects on first navigation", () => {
  it("drops the cached board and session after a saved workflow change", () => {
    expect(SETTINGS_UI).toContain("resetHousekeepingBoardCache");
    expect(SETTINGS_UI).toContain("SESSION_QUERY_KEY");
    expect(CLIENT).toContain("removeQueries");
    // No hard reload, no sign-out.
    expect(SETTINGS_UI).not.toContain("window.location.reload");
  });
});

describe("P1 — Do Not Disturb is visible and explains the first step", () => {
  it("names the exact first step for an uninitialised room", () => {
    expect(DND_SETUP_HINT).toMatch(/Ready or Dirty/i);
    expect(DND_SETUP_HINT).toMatch(/Do Not Disturb/i);
  });

  it("explains why DND is unavailable mid-clean", () => {
    expect(DND_CLEANING_HINT).toMatch(/Cleaning is in progress/i);
    expect(DND_CLEANING_HINT).toMatch(/Do Not Disturb/i);
  });

  it("renders one shared DND label in both the enabled and disabled states", () => {
    expect(DND_SET_LABEL).toBe("Set Do Not Disturb");
    expect(BOARD.split("{DND_SET_LABEL}").length - 1).toBeGreaterThanOrEqual(3);
  });

  it("shows a disabled DND control (never a hidden one) when it is not yet available", () => {
    expect(BOARD).toContain('<ActionButton tone="dnd" busy={false} disabled');
    expect(BOARD).toContain("dndBlockedByCleaning");
  });

  it("still lets the SERVER decide whether DND may actually be set", () => {
    expect(BOARD).toContain("room.canSetDnd");
    expect(BOARD).toContain("room.canClearDnd");
  });
});

describe("P1 — response-time stabilization", () => {
  it("issues the independent board reads together instead of sequentially", () => {
    expect(STORE).toMatch(
      /const \[roomsRes, hkRes, occupancy, handoffRead\] = await Promise\.all\(/,
    );
    expect(STORE).toMatch(/const \[physical, planned\] = await Promise\.all\(/);
  });

  it("keeps every fail-closed check after the parallel reads settle", () => {
    const idx = STORE.indexOf("const [roomsRes, hkRes, occupancy, handoffRead]");
    const after = STORE.slice(idx);
    expect(after).toContain(
      'if (roomsRes.error) throw new HousekeepingError("housekeeping_failed")',
    );
    expect(after).toContain(
      'if (handoffRead.status !== "ok") throw new HousekeepingError("readiness_read_failed")',
    );
  });

  it("still reconciles pending handoffs BEFORE reporting board conditions", () => {
    expect(BOARD_ROUTE.indexOf("reconcilePendingHandoffs")).toBeLessThan(
      BOARD_ROUTE.indexOf("getHousekeepingBoard({"),
    );
  });

  it("patches the changed room from the server DTO and re-derives counts", () => {
    expect(CLIENT).toContain("patchBoardWithRoom");
    expect(CLIENT).toContain("recomputeBoardCounts");
  });

  it("debounces the authoritative resync instead of racing the repaint", () => {
    expect(CLIENT).toContain("BOARD_RESYNC_DELAY_MS");
    expect(CLIENT).toContain("clearTimeout");
  });

  it("runs the post-write single-room read alongside the audit write", () => {
    expect(ROOM_ROUTE).toContain('const viewPromise = timings.measure("room_view"');
    expect(ROOM_ROUTE).toContain("room: await viewPromise");
  });
});

describe("P1 — stage timings are safe", () => {
  it("emits durations with fixed coarse stage names", () => {
    expect(formatServerTiming([{ name: "board", durationMs: 12.6 }])).toBe("board;dur=13");
  });

  it("sanitizes any name to a token charset, so no payload can leak through", () => {
    expect(sanitizeTimingName("select * from x where id='9'")).not.toContain("'");
    expect(sanitizeTimingName("a b;c=1")).toMatch(/^[a-zA-Z0-9_]+$/);
    expect(sanitizeTimingName("")).toBe("stage");
  });

  it("always reports a total and never negative durations", () => {
    const t = new ServerTimings();
    t.add("authz", -5);
    const list = t.list();
    expect(list.some((e) => e.name === "total")).toBe(true);
    expect(t.header()).toContain("authz;dur=0");
  });

  it("board and room endpoints attach Server-Timing without weakening no-store", () => {
    expect(BOARD_ROUTE).toContain('timings.headers({ "cache-control": "no-store" })');
    expect(ROOM_ROUTE).toContain('timings.headers({ "cache-control": "no-store" })');
  });
});

describe("guardrails", () => {
  it("the housekeeping browser client never touches N3 or the database", () => {
    expect(CLIENT).not.toMatch(/supabase|n3Token|Authorization/i);
  });

  it("the board component holds no client-side transition or ownership logic", () => {
    expect(BOARD).not.toMatch(/isOwner|nextCondition|NEXT_CONDITION|transitionMatrix/);
  });
});
