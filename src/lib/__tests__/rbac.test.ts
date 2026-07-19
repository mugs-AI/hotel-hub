import { describe, expect, it } from "vitest";
import {
  authorize,
  hasPermission,
  isHotelRole,
  HOTEL_ROLES,
} from "@/lib/rbac";

describe("hotel role matrix", () => {
  it("only recognizes the three confirmed roles", () => {
    expect(HOTEL_ROLES).toEqual(["owner", "front_desk", "housekeeper"]);
    expect(isHotelRole("owner")).toBe(true);
    expect(isHotelRole("front_desk")).toBe(true);
    expect(isHotelRole("housekeeper")).toBe(true);
    expect(isHotelRole("admin")).toBe(false);
    expect(isHotelRole("sales_manager")).toBe(false);
    expect(isHotelRole("finance")).toBe(false);
    expect(isHotelRole("salesperson")).toBe(false);
  });

  it("denies by default when role is missing or unknown", () => {
    expect(hasPermission(null, "app:view")).toBe(false);
    expect(hasPermission(undefined, "n3:verify")).toBe(false);
    // Casting past the type guard to prove deny-by-default at runtime.
    expect(hasPermission("admin" as unknown as "owner", "n3:verify")).toBe(false);
  });

  it("gates n3:verify to owner only", () => {
    expect(hasPermission("owner", "n3:verify")).toBe(true);
    expect(hasPermission("front_desk", "n3:verify")).toBe(false);
    expect(hasPermission("housekeeper", "n3:verify")).toBe(false);
  });

  it("gates roles:manage to owner only", () => {
    expect(hasPermission("owner", "roles:manage")).toBe(true);
    expect(hasPermission("front_desk", "roles:manage")).toBe(false);
    expect(hasPermission("housekeeper", "roles:manage")).toBe(false);
  });

  it("allows every role to load the shell (app:view)", () => {
    for (const role of HOTEL_ROLES) {
      expect(hasPermission(role, "app:view")).toBe(true);
    }
  });
});

describe("authorize()", () => {
  it("denies unauthenticated callers", () => {
    expect(
      authorize({ hasSession: false, tenantId: null, role: null }, "app:view"),
    ).toEqual({ ok: false, reason: "unauthenticated" });
  });

  it("denies when tenant is missing", () => {
    expect(
      authorize({ hasSession: true, tenantId: null, role: "owner" }, "app:view"),
    ).toEqual({ ok: false, reason: "unprovisioned" });
  });

  it("denies when role is unassigned", () => {
    expect(
      authorize(
        { hasSession: true, tenantId: "t1", role: null },
        "app:view",
      ),
    ).toEqual({ ok: false, reason: "role_unassigned" });
  });

  it("denies when permission is not granted to the role", () => {
    expect(
      authorize(
        { hasSession: true, tenantId: "t1", role: "housekeeper" },
        "n3:verify",
      ),
    ).toEqual({ ok: false, reason: "forbidden" });
  });

  it("allows when the role has the permission", () => {
    expect(
      authorize(
        { hasSession: true, tenantId: "t1", role: "owner" },
        "n3:verify",
      ),
    ).toEqual({ ok: true, role: "owner" });
  });
});
