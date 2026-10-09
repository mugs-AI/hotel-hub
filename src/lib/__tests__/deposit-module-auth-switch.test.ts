import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
const session = vi.hoisted(() => ({ value: {} as { data?: unknown; isError?: boolean } }));
vi.mock("@/lib/session-client", () => ({
  useSessionMe: () => session.value,
  SESSION_QUERY_KEY: ["session", "me"],
}));
import { DepositModuleSettingsPanel } from "@/components/DepositModuleSettingsPanel";
import { purgeSensitiveReceiptData } from "@/lib/receipt-controls-client";
const me = (tenant: string, role = "owner") => ({
  authenticated: true,
  tenant: { tenantId: tenant },
  user: { n3UserKey: "owner" },
  role,
});
const absent = {
  policy: { roomAdvanceEnabled: true, securityDepositEnabled: false, version: "0" },
  available: true,
  securityReady: false,
};
function seeded() {
  const qc = new QueryClient();
  qc.setQueryData(["deposit-module-policy", "tenant"], absent); // Legacy constant key must not render.
  qc.setQueryData(["deposit-module-policy", "A:owner:owner"], absent);
  return qc;
}
const render = (qc: QueryClient) =>
  renderToStaticMarkup(
    createElement(QueryClientProvider, { client: qc }, createElement(DepositModuleSettingsPanel)),
  );
beforeEach(() => {
  session.value = { data: me("A") };
});
it("shows the verified Owner's own policy", () => {
  expect(render(seeded())).toContain('aria-label="Room Advance Payments"');
});
it.each([
  { data: me("B") },
  { data: me("A", "front_desk") },
  { isError: true, data: me("A") },
  { data: { authenticated: false } },
])("never presents a previous Owner policy for %j", (next) => {
  session.value = next;
  expect(render(seeded())).not.toContain('role="switch"');
});
it("central auth purge removes foreign policy state including version-0 defaults", () => {
  const qc = seeded();
  purgeSensitiveReceiptData(qc, "B:owner:owner");
  expect(qc.getQueryData(["deposit-module-policy", "A:owner:owner"])).toBeUndefined();
  expect(qc.getQueryData(["deposit-module-policy", "tenant"])).toBeUndefined();
});
