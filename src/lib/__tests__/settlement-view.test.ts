import { describe, it, expect } from "vitest";
import { settlementPresentation, settlementPollInterval } from "../settlement-view";
import type { SettlementView } from "../settlement";
const v: SettlementView = {
  tenantId: "a",
  reservationId: "b",
  intentId: "c",
  snapshotDigest: "d",
  revision: "2",
  state: "needs_review",
  currency: "MYR",
  bill: {
    id: "e",
    code: "CS-SYNTHETIC",
    documentDate: "2026-10-08",
    totalCents: 50000,
    outstandingCents: 45000,
  },
  receipts: [],
  blockers: ["settlement_identity_requires_review"],
  allowedActions: [],
  verifiedAt: null,
};
describe("checkout settlement presentation", () => {
  it("needs review explains persisted recovery and hides unconfirmed amounts", () => {
    const p = settlementPresentation(v, true);
    expect(p.showMoney).toBe(false);
    expect(p.canReconcile).toBe(true);
    expect(p.message).toMatch(/Check N3 result/);
  });
  it("Front Desk has no recovery or financial action authority", () => {
    expect(settlementPresentation(v, false).canReconcile).toBe(false);
  });
  it("confirmed accounting values may display independently of payment confirmation", () => {
    expect(
      settlementPresentation(
        { ...v, state: "awaiting_payment", blockers: [], allowedActions: ["receive_balance"] },
        true,
      ).showMoney,
    ).toBe(true);
  });
  it("polls only in-flight states and stops at60seconds", () => {
    expect(settlementPollInterval("bill_dispatched", 0, 4999)).toBe(5000);
    expect(settlementPollInterval("balance_dispatched", 0, 59999)).toBe(5000);
    expect(settlementPollInterval("bill_dispatched", 0, 60000)).toBe(false);
    expect(settlementPollInterval("needs_review", 0, 1000)).toBe(false);
    expect(settlementPollInterval("closed", 0, 1000)).toBe(false);
  });
});

it("renders confirmed DD/MM/YYYY values and suppresses money on a failed scope", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { SettlementStatus } = await import("../../components/SettlementCard");
  const html = renderToStaticMarkup(
    createElement(SettlementStatus, {
      view: { ...v, blockers: [], state: "awaiting_payment" },
      owner: true,
    }),
  );
  expect(html).toContain("08/10/2026");
  expect(html).toContain("MYR 450.00");
  const failed = renderToStaticMarkup(createElement(SettlementStatus, { view: v, owner: true }));
  expect(failed).not.toContain("450.00");
});

it("an existing received payment is labelled as application without recollection", () => {
  const p = settlementPresentation(
    { ...v, state: "balance_dispatched", blockers: [], allowedActions: ["apply_balance"] },
    true,
  );
  expect(p.message).toMatch(/already recorded/);
});

it("renders saved balance application with no account or new-payment confirmation", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { SettlementCard } = await import("../../components/SettlementCard");
  for (const revision of ["created", "recovered"]) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["session", "me"], {
      authenticated: true,
      role: "owner",
      tenant: { tenantId: "a" },
      user: { n3UserKey: "owner" },
    });
    qc.setQueryData(["settlement", "a", "owner", "b"], {
      ...v,
      revision: revision === "created" ? "10" : "11",
      state: "balance_dispatched",
      blockers: [],
      allowedActions: ["apply_balance"],
    });
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(SettlementCard, { reservationId: "b", owner: true }),
      ),
    );
    expect(html).toContain("Apply received payment");
    expect(html).not.toContain("Confirm balance payment");
    expect(html).not.toContain("checkbox");
    expect(html).not.toContain("select");
    qc.clear();
  }
});
