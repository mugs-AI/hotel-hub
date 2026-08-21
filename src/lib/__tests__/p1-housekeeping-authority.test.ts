/**
 * HotelHub P1 correction — mode authority, readiness and room-change handoff.
 *
 * These tests lock the rules a guest depends on:
 *   1. The workflow the property actually runs decides who may move a room —
 *      a static role permission is never enough on its own.
 *   2. The dedicated workspace does not exist in a simple front-desk property.
 *   3. An early check-in or room change is refused into a room that is not
 *      verified clean.
 *   4. The room a guest leaves is recorded durably and ends up Dirty.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  authorizedTransitions,
  canPerformTransition,
  housekeepingAuthority,
  HOUSEKEEPING_TRANSITIONS,
  type HousekeepingMode,
  type RoomTurnaroundState,
} from "@/lib/housekeeping";
import { destinationBlockerCode } from "@/lib/reservation-operations.server";
import { statusForOperationError } from "@/lib/operations-api.server";
import { statusForHousekeepingError } from "@/lib/housekeeping-store.server";
import type { HotelRole } from "@/lib/rbac";

function state(over: Partial<RoomTurnaroundState> = {}): RoomTurnaroundState {
  return {
    initialized: true,
    condition: "ready",
    dndActive: false,
    occupancy: "vacant",
    isActive: true,
    ...over,
  };
}

function auth(mode: HousekeepingMode, role: HotelRole | null) {
  return housekeepingAuthority(mode, role);
}

describe("1. Mode-aware authority", () => {
  it("simple: the desk turns rooms around and owns the whole lifecycle", () => {
    for (const role of ["owner", "front_desk"] as const) {
      const a = auth("simple", role);
      expect(a.canViewBoard).toBe(true);
      expect(a.roleTransitions.sort()).toEqual([...HOUSEKEEPING_TRANSITIONS].sort());
      expect(a.canToggleDnd).toBe(true);
    }
  });

  it("simple: a housekeeper has no board and no authority at all", () => {
    const a = auth("simple", "housekeeper");
    expect(a.canViewBoard).toBe(false);
    expect(a.canUseDedicatedWorkspace).toBe(false);
    expect(a.roleTransitions).toEqual([]);
    expect(a.canToggleDnd).toBe(false);
    expect(authorizedTransitions(a, state({ condition: "dirty" }))).toEqual([]);
  });

  it("dedicated: the housekeeping team owns the cleaning lifecycle", () => {
    const a = auth("dedicated", "housekeeper");
    expect(a.canViewBoard).toBe(true);
    expect(a.canUseDedicatedWorkspace).toBe(true);
    expect(a.roleTransitions.sort()).toEqual([...HOUSEKEEPING_TRANSITIONS].sort());
    expect(canPerformTransition(a, state({ condition: "dirty" }), "start_cleaning")).toBe(true);
    expect(canPerformTransition(a, state({ condition: "inspected" }), "mark_ready")).toBe(true);
  });

  it("dedicated: the desk may report a sellable room dirty, nothing more", () => {
    const a = auth("dedicated", "front_desk");
    expect(a.roleTransitions).toEqual(["mark_dirty"]);
    expect(canPerformTransition(a, state({ condition: "ready" }), "mark_dirty")).toBe(true);
    // Must never advance a clean it did not perform or verify.
    expect(canPerformTransition(a, state({ condition: "dirty" }), "start_cleaning")).toBe(false);
    expect(canPerformTransition(a, state({ condition: "cleaning" }), "finish_cleaning")).toBe(false);
    expect(canPerformTransition(a, state({ condition: "inspected" }), "mark_ready")).toBe(false);
    // Nor abandon a clean that is under way.
    expect(canPerformTransition(a, state({ condition: "cleaning" }), "mark_dirty")).toBe(false);
  });

  it("dedicated: the Owner keeps full authority", () => {
    const a = auth("dedicated", "owner");
    expect(a.roleTransitions.sort()).toEqual([...HOUSEKEEPING_TRANSITIONS].sort());
    expect(a.canToggleDnd).toBe(true);
    expect(a.canInitialize).toBe(true);
  });

  it("mode can only narrow the static matrix, never widen it", () => {
    for (const mode of ["simple", "dedicated"] as const) {
      // Housekeeper never gains Do Not Disturb or bootstrap authority.
      expect(auth(mode, "housekeeper").canToggleDnd).toBe(false);
      expect(auth(mode, "housekeeper").canInitialize).toBe(false);
      // Front desk never gains the Owner-only bootstrap act.
      expect(auth(mode, "front_desk").canInitialize).toBe(false);
      // No role at all gets nothing.
      expect(auth(mode, null).canViewBoard).toBe(false);
      expect(auth(mode, null).roleTransitions).toEqual([]);
    }
  });

  it("DND still freezes the lifecycle for every authorised role", () => {
    for (const role of ["owner", "front_desk", "housekeeper"] as const) {
      expect(authorizedTransitions(auth("dedicated", role), state({ dndActive: true }))).toEqual(
        [],
      );
    }
  });

  it("a mode refusal is a 403, not a 409 lifecycle error", () => {
    expect(statusForHousekeepingError("not_permitted_in_mode")).toBe(403);
  });
});

describe("2. Dedicated workspace gate fails closed", () => {
  const src = readFileSync(resolve(__dirname, "../../routes/housekeeping.tsx"), "utf8");
  const shell = readFileSync(resolve(__dirname, "../../components/AppShell.tsx"), "utf8");
  const boardRoute = readFileSync(
    resolve(__dirname, "../../routes/api/hotel/housekeeping.ts"),
    "utf8",
  );

  it("no role can use the dedicated workspace in simple mode", () => {
    for (const role of ["owner", "front_desk", "housekeeper"] as const) {
      expect(auth("simple", role).canUseDedicatedWorkspace).toBe(false);
    }
  });

  it("the route renders the board only behind the mode gate", () => {
    expect(src).toMatch(/canUseDedicatedWorkspace/);
    expect(src).toMatch(/DEDICATED_UNAVAILABLE_SIMPLE/);
  });

  it("navigation hides the workspace unless the mode allows it", () => {
    expect(shell).toMatch(/hkAuthority\.canUseDedicatedWorkspace/);
  });

  it("the server refuses board data when the mode denies it", () => {
    expect(boardRoute).toMatch(/housekeepingAuthority\(mode, ctx\.role\)/);
    expect(boardRoute).toMatch(/canViewBoard\) return deny\(403, "not_permitted_in_mode"\)/);
  });
});

describe("3. Readiness gating for approvals", () => {
  const decisionSrc = readFileSync(
    resolve(
      __dirname,
      "../../routes/api/hotel/reservations.$id.operations.$requestId.decision.ts",
    ),
    "utf8",
  );

  it("restates a readiness blocker from the destination's side", () => {
    expect(destinationBlockerCode("housekeeping_not_initialized")).toBe(
      "destination_housekeeping_not_initialized",
    );
    expect(destinationBlockerCode("room_not_ready")).toBe("destination_room_not_ready");
    expect(destinationBlockerCode("dnd_active")).toBe("destination_dnd_active");
  });

  it("surfaces destination refusals as 409 conflicts", () => {
    for (const code of [
      "destination_housekeeping_not_initialized",
      "destination_room_not_ready",
      "destination_dnd_active",
    ]) {
      expect(statusForOperationError(code)).toBe(409);
    }
  });

  it("checks readiness BEFORE the decision is applied", () => {
    const gateAt = decisionSrc.indexOf("Readiness gate");
    const decideAt = decisionSrc.indexOf("await decideOperation(");
    expect(gateAt).toBeGreaterThan(-1);
    expect(decideAt).toBeGreaterThan(gateAt);
    expect(decisionSrc).toMatch(/housekeepingCheckInBlocker\(tenantId, id\)/);
    expect(decisionSrc).toMatch(/roomReadinessBlocker\(tenantId, \[dest\]\)/);
  });
});

describe("4. Room-change handoff is durable", () => {
  const decisionSrc = readFileSync(
    resolve(
      __dirname,
      "../../routes/api/hotel/reservations.$id.operations.$requestId.decision.ts",
    ),
    "utf8",
  );
  const storeSrc = readFileSync(resolve(__dirname, "../housekeeping-store.server.ts"), "utf8");

  it("records the intent before approval and cancels it if approval fails", () => {
    const enqueueAt = decisionSrc.indexOf("enqueueRoomHandoff(");
    const decideAt = decisionSrc.indexOf("await decideOperation(");
    expect(enqueueAt).toBeGreaterThan(-1);
    expect(decideAt).toBeGreaterThan(enqueueAt);
    expect(decisionSrc).toMatch(/if \(handoffId\) await cancelRoomHandoff\(tenantId, handoffId\)/);
  });

  it("applies the handoff atomically and never swallows a failure", () => {
    expect(storeSrc).toMatch(/hotelhub_hk_vacate_room_v2/);
    expect(storeSrc).toMatch(/failRoomHandoff/);
    expect(decisionSrc).toMatch(/hotel\.housekeeping\.vacate_pending/);
    expect(decisionSrc).toMatch(/housekeepingHandoff/);
  });

  it("retries outstanding handoffs on the board read and after a decision", () => {
    const boardRoute = readFileSync(
      resolve(__dirname, "../../routes/api/hotel/housekeeping.ts"),
      "utf8",
    );
    expect(boardRoute).toMatch(/reconcilePendingHandoffs/);
    expect(decisionSrc).toMatch(/reconcilePendingHandoffs/);
  });

  it("the legacy fire-and-forget vacate helper is gone", () => {
    expect(storeSrc).not.toMatch(/vacateRoomSafely/);
  });
});

describe("SQL — durable handoff migration", () => {
  const dir = resolve(__dirname, "../../../supabase/migrations");
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(resolve(dir, f), "utf8"))
    .find((text) => text.includes("hotelhub_hk_vacate_room_v2"));

  it("ships the handoff queue and its routines", () => {
    expect(sql).toBeTruthy();
    expect(sql!).toMatch(/CREATE TABLE public\.hotel_housekeeping_handoffs/);
    expect(sql!).toMatch(/hotelhub_hk_enqueue_handoff/);
    expect(sql!).toMatch(/hotelhub_hk_cancel_handoff/);
    expect(sql!).toMatch(/hotelhub_hk_fail_handoff/);
    expect(sql!).toMatch(/hotelhub_hk_list_pending_handoffs/);
  });

  it("keeps the queue server-only: RLS on, no policies, service_role grant", () => {
    expect(sql!).toMatch(
      /ALTER TABLE public\.hotel_housekeeping_handoffs ENABLE ROW LEVEL SECURITY/,
    );
    expect(sql!).toMatch(/GRANT ALL ON public\.hotel_housekeeping_handoffs TO service_role/);
    expect(sql!).not.toMatch(/CREATE POLICY[^;]*hotel_housekeeping_handoffs/);
    expect(sql!).toMatch(/REVOKE ALL ON FUNCTION public\.hotelhub_hk_vacate_room_v2/);
  });

  it("a room a guest just left is set up as Dirty rather than skipped", () => {
    const fn = sql!.slice(sql!.indexOf("hotelhub_hk_vacate_room_v2"));
    expect(fn).toMatch(/INSERT INTO hotel_room_housekeeping/);
    expect(fn).toMatch(/'dirty'/);
    expect(fn).toMatch(/dnd_active = false/);
    // Condition change, history entry and queue closure in one transaction.
    expect(fn).toMatch(/INSERT INTO hotel_housekeeping_events/);
    expect(fn).toMatch(/SET state = 'applied'/);
  });
});
