import { describe, expect, it } from "vitest";
import { clampMonth, parseMonth, shiftMonth } from "../month-nav";

describe("financial month navigation", () => {
  it("rolls over years in both directions", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2024-02", 12)).toBe("2025-02");
  });
  it("rejects months outside 01–12 and malformed input", () => {
    for (const v of ["2026-00", "2026-13", "2026-1", "26-01", "", "1999-12"])
      expect(parseMonth(v)).toBeNull();
    expect(shiftMonth("2026-13", 1)).toBeNull();
  });
  it("clamps to the allowed window", () => {
    expect(clampMonth("2027-01", "2000-01", "2026-10")).toBe("2026-10");
    expect(clampMonth("1999-12", "2000-01", "2026-10")).toBe("2000-01");
  });
});
