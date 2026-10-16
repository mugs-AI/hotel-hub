import { describe, expect, it } from "vitest";
import { validateNoShowInput, noShowEligible } from "../reservation-no-show";
const input = {
  reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  clientRequestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  expectedUpdatedAt: "2026-10-13T01:00:00.123456Z",
  reason: "Guest did not arrive",
};
describe("manual no-show eligibility and input", () => {
  it("permits a confirmed booking only after its arrival day", () => {
    expect(noShowEligible("confirmed", "2026-10-13", "2026-10-14")).toBe(true);
    expect(noShowEligible("confirmed", "2026-10-14", "2026-10-14")).toBe(false);
    expect(noShowEligible("confirmed", "2026-10-15", "2026-10-14")).toBe(false);
  });
  it.each(["checked_in", "checked_out", "cancelled", "no_show", "tentative"])(
    "refuses %s",
    (status) => expect(noShowEligible(status, "2026-10-13", "2026-10-14")).toBe(false),
  );
  it("accepts valid reason and full timestamp revision", () =>
    expect(() => validateNoShowInput(input)).not.toThrow());
  it.each([
    { reason: " " },
    { reason: "x".repeat(501) },
    { reservationId: "bad" },
    { clientRequestId: "bad" },
    { expectedUpdatedAt: "2026-02-30T01:00:00Z" },
    { tenantId: "alien" },
  ])("refuses malformed or browser scope inputs %j", (patch) =>
    expect(() => validateNoShowInput({ ...input, ...patch })).toThrow("invalid_request"),
  );
  it.each(["2026-02-30", "2026-10-40", "garbage"])("refuses invalid property date %s", (date) =>
    expect(noShowEligible("confirmed", "2026-10-13", date)).toBe(false),
  );
});
