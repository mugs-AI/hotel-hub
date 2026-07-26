// Calendar `Add Reservation` button visibility rule: Owner + Front Desk only,
// Housekeeper hidden. The button itself uses the `hotel:reservations:create`
// permission via `hasPermission(...)` inside the calendar header.
import { describe, expect, it } from "vitest";
import { hasPermission, type HotelRole } from "@/lib/rbac";

describe("Calendar Add Reservation button visibility", () => {
  const roles: Array<[HotelRole | null, boolean]> = [
    ["owner", true],
    ["front_desk", true],
    ["housekeeper", false],
    [null, false],
  ];
  for (const [role, expected] of roles) {
    it(`role=${String(role)} → canCreate=${expected}`, () => {
      expect(hasPermission(role, "hotel:reservations:create")).toBe(expected);
    });
  }
});
