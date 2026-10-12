import { expect, it } from "vitest";
import { assertFreshReceiptContext } from "../receipt-staff-authority.server";
import type { RequestContext } from "../session-context.server";
const actor = {
  tenantId: "t",
  n3TenantKey: "n",
  n3UserKey: "u",
  n3Token: "private",
  role: "front_desk" as const,
};
const ctx = {
  authenticated: true,
  session: { tenantId: "t", n3UserKey: "u", n3Token: "private" },
  role: "front_desk",
} as RequestContext;
it("binds the same tenant user token and role", () => {
  expect(() => assertFreshReceiptContext(actor, ctx)).not.toThrow();
});
it.each([
  { role: "owner" },
  { role: "housekeeper" },
  { session: { tenantId: "alien", n3UserKey: "u", n3Token: "private" } },
  { session: { tenantId: "t", n3UserKey: "other", n3Token: "private" } },
  { session: { tenantId: "t", n3UserKey: "u", n3Token: "rotated" } },
])("denies changed authority %j", (patch) => {
  expect(() => assertFreshReceiptContext(actor, { ...ctx, ...patch } as RequestContext)).toThrow(
    "forbidden",
  );
});
it("rejects expired session", () => {
  expect(() => assertFreshReceiptContext(actor, { authenticated: false })).toThrow("unauthorized");
});
