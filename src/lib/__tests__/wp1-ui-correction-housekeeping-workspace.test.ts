/**
 * WP1 APPROVED UI CORRECTION — Housekeeping simplification + separation from
 * Rooms & Rates.
 *
 * Guard tests only: no business rule, lifecycle, gate or server-safety change
 * is asserted or introduced here.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { housekeepingAuthority } from "@/lib/housekeeping";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const ROOMS_RATES = read("../../routes/rooms-rates.tsx");
const SHELL = read("../../components/AppShell.tsx");
const ROUTE = read("../../routes/housekeeping.tsx");
const BOARD = read("../../components/HousekeepingBoard.tsx");
const BOARD_API = read("../../routes/api/hotel/housekeeping.ts");
const ROOM_API = read("../../routes/api/hotel/housekeeping.rooms.$roomId.ts");
const SETTINGS = read("../../routes/settings.tsx");

describe("A/B. Rooms & Rates is separated from housekeeping", () => {
  it("does not mount the housekeeping board or any housekeeping action", () => {
    expect(ROOMS_RATES).not.toMatch(/HousekeepingBoard/);
    expect(ROOMS_RATES).not.toMatch(/Room readiness/i);
    expect(ROOMS_RATES).not.toMatch(/housekeeping/i);
  });

  it("keeps its own inventory, mapping, rate and setup content", () => {
    expect(ROOMS_RATES).toMatch(/Rooms &amp; Rates/);
    expect(ROOMS_RATES).toMatch(/Base rate/i);
    expect(ROOMS_RATES).toMatch(/stock/i);
    expect(ROOMS_RATES).toMatch(/Max guests/);
  });
});

describe("C–I. Workspace visibility by mode and role", () => {
  const cases = [
    { mode: "simple", role: "owner", open: true, dedicated: false },
    { mode: "simple", role: "front_desk", open: true, dedicated: false },
    { mode: "simple", role: "housekeeper", open: false, dedicated: false },
    { mode: "dedicated", role: "owner", open: true, dedicated: true },
    { mode: "dedicated", role: "front_desk", open: true, dedicated: true },
    { mode: "dedicated", role: "housekeeper", open: true, dedicated: true },
  ] as const;

  for (const c of cases) {
    it(`${c.mode} ${c.role}: canOpenWorkspace=${c.open}`, () => {
      const a = housekeepingAuthority(c.mode, c.role);
      expect(a.canOpenWorkspace).toBe(c.open);
      expect(a.canUseDedicatedWorkspace).toBe(c.dedicated);
      expect(a.canOpenWorkspace).toBe(a.canViewBoard);
    });
  }

  it("navigation and the route both use the same authority flag", () => {
    expect(SHELL).toMatch(/hkAuthority\.canOpenWorkspace/);
    expect(ROUTE).toMatch(/authority\.canOpenWorkspace/);
    expect(ROUTE).toMatch(/canUseDedicatedWorkspace \? "dedicated" : "simple"/);
  });
});

describe("J. Server authorization remains authoritative", () => {
  it("the board API still resolves mode + role server-side and fails closed", () => {
    expect(BOARD_API).toMatch(/housekeepingAuthority\(mode, ctx\.role\)/);
    expect(BOARD_API).toMatch(/canViewBoard\) return deny\(403, "not_permitted_in_mode"\)/);
  });

  it("the room action API still resolves authority server-side", () => {
    expect(ROOM_API).toMatch(/housekeepingAuthority\(settings\?\.housekeepingMode \?\? "simple", ctx\.role\)/);
  });
});

describe("K/L. Ready is de-emphasised, needs-action is the default", () => {
  it("the default filter is needs_action", () => {
    expect(BOARD).toMatch(/useState<Filter>\("needs_action"\)/);
  });

  it("Ready rooms are collapsed behind a counter with an explicit reveal", () => {
    expect(BOARD).toMatch(/Show Ready rooms/);
    expect(BOARD).toMatch(/filter !== "ready" && tally\.ready > 0/);
  });
});

describe("M/N. Actions and blockers come from the server", () => {
  it("renders only server-provided transitions and DND capabilities", () => {
    expect(BOARD).toMatch(/room\.availableTransitions\.map/);
    expect(BOARD).toMatch(/canDnd && room\.canSetDnd/);
    expect(BOARD).toMatch(/canDnd && room\.canClearDnd/);
    expect(BOARD).toMatch(/authority\.canInitialize/);
  });

  it("has no client-side legality matrix", () => {
    expect(BOARD).not.toMatch(/allowedTransitions|authorizedTransitions/);
  });

  it("keeps DND and check-in blockers visible", () => {
    expect(BOARD).toMatch(/Do Not Disturb — cleaning paused\./);
    expect(BOARD).toMatch(/Arrival today is blocked: \{blockerLabel/);
  });

  it("marks the forward step as the primary action and keeps corrections quiet", () => {
    expect(BOARD).toMatch(
      /PRIMARY_TRANSITIONS: HousekeepingTransition\[\] = \[\s*"start_cleaning",\s*"finish_cleaning",\s*"mark_ready",/,
    );
    expect(BOARD).not.toMatch(/"mark_dirty",\s*\n\s*"revert_to_cleaning",\s*\n\];/);
  });
});

describe("O. Settings placement is unchanged", () => {
  it("Housekeeping workflow stays under Settings → System", () => {
    expect(SETTINGS).toMatch(/System/);
    expect(SETTINGS).toMatch(/Housekeeping workflow/);
  });
});
