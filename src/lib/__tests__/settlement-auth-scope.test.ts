import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
const session = vi.hoisted(() => ({ value: {} as { data?: unknown; isError?: boolean } }));
vi.mock("../session-client", () => ({
  useSessionMe: () => session.value,
  SESSION_QUERY_KEY: ["session", "me"],
}));
import { useSettlement } from "../settlement-client";
import { purgeSensitiveReceiptData } from "../receipt-controls-client";
const me = (role = "owner") => ({
  authenticated: true,
  tenant: { tenantId: "A" },
  user: { n3UserKey: "user" },
  role,
});
function seeded() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const fact = {
    tenantId: "A",
    reservationId: "r",
    revision: "0",
    bill: { totalCents: 99999 },
    allowedActions: ["receive_balance"],
  };
  qc.setQueryData(["settlement", "A", "user", "r"], fact);
  qc.setQueryData(["settlement", "A:user:owner", "r"], fact);
  return qc;
}
function Probe() {
  const q = useSettlement("r");
  return createElement("div", null, q.data ? "SAVED_FINANCIAL_FACT" : "NO_VERIFIED_FACT");
}
const render = (qc: QueryClient) =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(Probe)));
beforeEach(() => {
  session.value = { data: me() };
});
it("never renders cached settlement when session read fails with stale authenticated data", () => {
  session.value = { data: me(), isError: true };
  expect(render(seeded())).not.toContain("SAVED_FINANCIAL_FACT");
});
it("role downgrade cannot reuse Owner settlement cache", () => {
  session.value = { data: me("front_desk") };
  expect(render(seeded())).not.toContain("SAVED_FINANCIAL_FACT");
});
it("central identity purge removes old/legacy settlement data", () => {
  const qc = seeded();
  purgeSensitiveReceiptData(qc, "B:user:owner");
  expect(qc.getQueryCache().findAll({ queryKey: ["settlement"] })).toHaveLength(0);
});
it("current verified identity can read its own settlement cache", () => {
  expect(render(seeded())).toContain("SAVED_FINANCIAL_FACT");
});
it("unmounted sign-out cancels a late settlement response and removes old cache", async () => {
  const qc = seeded();
  let finish!: (v: unknown) => void;
  let aborted = false;
  const pending = qc
    .fetchQuery({
      queryKey: ["settlement", "A:user:owner", "late"],
      queryFn: ({ signal }) => {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    })
    .catch(() => undefined);
  purgeSensitiveReceiptData(qc, null);
  finish({ tenantId: "A", reservationId: "late", totalCents: 12345 });
  await pending;
  expect(aborted).toBe(true);
  expect(qc.getQueryCache().findAll({ queryKey: ["settlement"] })).toHaveLength(0);
});
