import { describe, expect, it } from "vitest";
import { validateAutomaticActionBody } from "../receipt-automation-http.server";
describe("automatic action HTTP input", () => {
  it("accepts a version and the endpoint-owned action only", () => {
    expect(validateAutomaticActionBody({ expectedVersion: 1 }, "apply")).toEqual({
      expectedVersion: 1,
      action: "apply",
    });
    expect(
      validateAutomaticActionBody({ expectedVersion: 2, decision: "approve" }, "approve").action,
    ).toBe("approve");
  });
  it.each([
    { expectedVersion: 1, role: "owner" },
    { expectedVersion: 1, tenantId: "alien" },
    { expectedVersion: 1, automation: {} },
    { expectedVersion: 1, payload: {} },
    { expectedVersion: 1, decision: "reject" },
    { expectedVersion: "1" },
    { expectedVersion: 0 },
  ])("refuses forged authority/payload and invalid version %j", (body) =>
    expect(() => validateAutomaticActionBody(body, "approve")).toThrow(),
  );
});
