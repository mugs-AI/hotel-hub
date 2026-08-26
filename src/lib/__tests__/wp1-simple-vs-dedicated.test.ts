/**
 * WP1 HOUSEKEEPING — SAME ENGINE, TWO EXPERIENCES.
 *
 * The lifecycle is identical in both modes: Ready -> Dirty -> Cleaning ->
 * Inspected -> Ready plus the approved corrective transitions. Only the
 * presentation differs. The server role matrix is unchanged.
 *
 * Also guards the corrected Settings wording: housekeeping actions no longer
 * live in Rooms & Rates.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HK_COLORS,
  HOUSEKEEPING_TRANSITIONS,
  MODE_PRESENTATION,
  ROLE_HINTS,
  WORKFLOW_LEGEND,
  housekeepingAuthority,
} from "@/lib/housekeeping";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const BOARD = read("../../components/HousekeepingBoard.tsx");
const BANNER = read("../../components/HousekeepingModeBanner.tsx");
const SETTINGS_PANELS = read("../../components/PropertySettingsPanels.tsx");
const ROUTE = read("../../routes/housekeeping.tsx");

describe("WP1 mode presentation", () => {
  it("Simple and Dedicated banners name their experience distinctly", () => {
    expect(MODE_PRESENTATION.simple.title).toBe("Simple — Front Desk Housekeeping");
    expect(MODE_PRESENTATION.dedicated.title).toBe("Dedicated Housekeeping Team");
    expect(MODE_PRESENTATION.simple.accent).not.toBe(MODE_PRESENTATION.dedicated.accent);
    expect(MODE_PRESENTATION.dedicated.accent).toBe(HK_COLORS.indigo);
    expect(BANNER).toContain("presentation.title");
  });

  it("shows a non-PII role hint in the dedicated experience", () => {
    expect(Object.keys(ROLE_HINTS).sort()).toEqual(["front_desk", "housekeeper", "owner"]);
    for (const hint of Object.values(ROLE_HINTS)) {
      expect(hint).not.toMatch(/@|\+\d|\bIC\b|passport/i);
    }
    expect(BANNER).toContain('mode === "dedicated" && roleHint');
  });

  it("dedicated adds the workflow legend; floors and History serve both modes", () => {
    // Floor filters and per-room History are available in both experiences
    // (approved usability correction); the workflow legend stays dedicated-only.
    expect(BOARD).toContain("floors.length > 1");
    expect(BOARD).toContain("onHistory={() => setHistoryRoomId(room.roomId)}");
    expect(BOARD).toMatch(/variant === "dedicated" &&[\s\S]{0,400}WORKFLOW_LEGEND\.map/);
    expect(WORKFLOW_LEGEND).toEqual(["dirty", "cleaning", "inspected", "ready"]);
  });

  it("the simple surface does not emphasise dedicated-only tooling", () => {
    // Simple has no variant-specific tooling branches of its own.
    expect(BOARD).not.toContain('variant === "simple" && floors');
    expect(BOARD).toContain('variant === "dedicated" && (');
    expect(ROUTE).toContain('authority.canUseDedicatedWorkspace ? "dedicated" : "simple"');
  });
});

describe("WP1 lifecycle is identical in both modes", () => {
  it("no mode-specific transition is invented", () => {
    expect([...HOUSEKEEPING_TRANSITIONS].sort()).toEqual(
      [
        "finish_cleaning",
        "mark_dirty",
        "mark_ready",
        "revert_to_cleaning",
        "start_cleaning",
      ].sort(),
    );
    expect(housekeepingAuthority("dedicated", "owner").roleTransitions.sort()).toEqual(
      housekeepingAuthority("simple", "owner").roleTransitions.sort(),
    );
  });

  it("the server role matrix is unchanged", () => {
    const simpleOwner = housekeepingAuthority("simple", "owner");
    expect(simpleOwner.canViewBoard).toBe(true);
    expect(simpleOwner.roleTransitions.length).toBe(HOUSEKEEPING_TRANSITIONS.length);

    const simpleFrontDesk = housekeepingAuthority("simple", "front_desk");
    expect(simpleFrontDesk.canViewBoard).toBe(true);
    expect(simpleFrontDesk.roleTransitions.length).toBe(HOUSEKEEPING_TRANSITIONS.length);

    const simpleHousekeeper = housekeepingAuthority("simple", "housekeeper");
    expect(simpleHousekeeper.canViewBoard).toBe(false);
    expect(simpleHousekeeper.canOpenWorkspace).toBe(false);
    expect(simpleHousekeeper.roleTransitions).toEqual([]);
    expect(simpleHousekeeper.canToggleDnd).toBe(false);

    const dedicatedOwner = housekeepingAuthority("dedicated", "owner");
    expect(dedicatedOwner.canUseDedicatedWorkspace).toBe(true);
    expect(dedicatedOwner.canInitialize).toBe(true);

    const dedicatedHousekeeper = housekeepingAuthority("dedicated", "housekeeper");
    expect(dedicatedHousekeeper.canViewBoard).toBe(true);
    expect(dedicatedHousekeeper.roleTransitions.length).toBe(HOUSEKEEPING_TRANSITIONS.length);
    expect(dedicatedHousekeeper.canToggleDnd).toBe(true);

    const dedicatedFrontDesk = housekeepingAuthority("dedicated", "front_desk");
    expect(dedicatedFrontDesk.roleTransitions).toEqual(["mark_dirty"]);
    expect(dedicatedFrontDesk.markDirtyOnlyFromReady).toBe(true);

    expect(housekeepingAuthority("simple", null).canViewBoard).toBe(false);
  });
});

describe("WP1 settings wording is truthful", () => {
  it("no source text claims housekeeping actions happen in Rooms & Rates", () => {
    for (const src of [SETTINGS_PANELS, BOARD, BANNER, ROUTE]) {
      expect(src).not.toMatch(/marks rooms[^.]*from Rooms & Rates/i);
      expect(src).not.toMatch(/readiness lives on Rooms & Rates/i);
    }
  });

  it("Settings → System describes the Housekeeping workspace for both modes", () => {
    expect(SETTINGS_PANELS).toContain(
      "Front Desk or the Owner runs room turnaround in the Housekeeping workspace.",
    );
    expect(SETTINGS_PANELS).toContain(
      "The housekeeping team uses the Housekeeping workspace with the dedicated tools",
    );
    expect(SETTINGS_PANELS).toContain("This setting only\n        selects the workflow mode.");
  });
});
