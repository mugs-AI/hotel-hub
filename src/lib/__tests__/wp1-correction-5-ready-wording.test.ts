/**
 * WP1 CORRECTION 5 — truthful Ready wording.
 *
 * Housekeeping "Ready" means housekeeping-cleared only. It never means the
 * room is vacant, saleable, unreserved, or check-in eligible: booking and
 * allocation truth lives elsewhere and still applies.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CONDITION_HELP, confirmationFor, nextStepHint } from "@/lib/housekeeping";

const FORBIDDEN = [/safe to sell/i, /ready to sell/i, /can be sold and checked into/i];

const WP1_FILES = ["../housekeeping.ts", "../../components/HousekeepingBoard.tsx"];

describe("L. Ready never claims the room is saleable", () => {
  it("the Ready condition help is housekeeping-only and preserves booking truth", () => {
    const help = CONDITION_HELP.ready;
    for (const bad of FORBIDDEN) expect(help).not.toMatch(bad);
    expect(help.toLowerCase()).toContain("housekeeping");
    expect(help.toLowerCase()).toMatch(/booking/);
  });

  it("the mark-ready confirmation does not promise sale or check-in", () => {
    const msg = confirmationFor("101", "mark_ready", "ready");
    for (const bad of FORBIDDEN) expect(msg).not.toMatch(bad);
    expect(msg.toLowerCase()).toContain("housekeeping is complete");
    expect(msg.toLowerCase()).toMatch(/check-in rules still apply/);
  });

  it("a Ready room's next step is simply that housekeeping is complete", () => {
    const hint = nextStepHint({
      isActive: true,
      initialized: true,
      dndActive: false,
      condition: "ready",
      occupancy: "vacant",
    } as never);
    for (const bad of FORBIDDEN) expect(hint).not.toMatch(bad);
    expect(hint.toLowerCase()).toContain("housekeeping is complete");
  });

  it("no WP1 housekeeping surface conflates Ready with saleable", () => {
    for (const rel of WP1_FILES) {
      const src = readFileSync(resolve(__dirname, rel), "utf8");
      for (const bad of FORBIDDEN) expect(src, rel).not.toMatch(bad);
    }
  });
});
