import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DepositDTO } from "@/lib/deposits-client";

const session = vi.hoisted(() => ({
  value: {} as { isError?: boolean; data?: unknown },
}));
vi.mock("@/lib/session-client", () => ({ useSessionMe: () => session.value }));
vi.mock("@/lib/deposits-client", async (o) => ({
  ...(await o<typeof import("@/lib/deposits-client")>()),
  usePaymentAccounts: () => ({ data: { accounts: [] }, isPending: false }),
}));

import {
  identityFromSession,
  purgeSensitiveReceiptData,
  receiptControlsKey,
} from "@/lib/receipt-controls-client";
import { financialKeys } from "@/lib/financial-reporting-client";
import { ReceiptControlRequestDialog } from "@/components/ReceiptControlRequestDialog";

const me = (tenant: string, user: string, role: string) => ({
  authenticated: true,
  tenant: { tenantId: tenant },
  user: { n3UserKey: user },
  role,
});
const A = "tA:uOwner:owner";
const RES = "11111111-1111-4111-8111-111111111111";
const deposit = { id: "dep-1", amount: 50, status: "posted" } as unknown as DepositDTO;
const SECRET = "Owner-A-Secret-Customer";

function seeded() {
  const qc = new QueryClient();
  qc.setQueryData(["receipt-controls", A, "original", RES, deposit.id], {
    original: {
      amountCents: 5000,
      currency: "MYR",
      accountId: "acc",
      accountLabel: "A-Bank",
      contact: { customerName: SECRET, remark1: "addr-A", remark2: "", remark3: "", remark4: "" },
    },
  });
  qc.setQueryData(receiptControlsKey(A, `reservation:${RES}`), [{ reason: "A-audit-reason" }]);
  qc.setQueryData(receiptControlsKey(A, "queue"), { pages: [] });
  qc.setQueryData(financialKeys.dashboard(A, "2026-10"), { deposits: 123 });
  return qc;
}

const render = (qc: QueryClient) =>
  renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: qc },
      createElement(ReceiptControlRequestDialog, {
        reservationId: RES,
        deposit,
        kind: "correction",
        onClose: () => {},
      }),
    ),
  );

beforeEach(() => {
  session.value = { data: me("tA", "uOwner", "owner") };
});

describe("receipt/finance cache namespace on auth switch (no Owner dashboard mounted)", () => {
  it("shows a pre-submit verification warning and safely explains a null number field", () => {
    const qc = seeded();
    const key = ["receipt-controls", A, "original", RES, deposit.id];
    const data = qc.getQueryData<{ original: object }>(key)!;
    qc.setQueryData(key, {
      original: {
        ...data.original,
        journal: { exact: false, reasons: ["journal_row_doc_code_null"] },
      },
    });
    const html = render(qc);
    expect(html).toContain("This receipt’s N3 journal could not be verified. Sending is blocked.");
    expect(html).toContain("N3 returned an empty receipt-number field on a journal line");
    expect(html).not.toContain("The request was not created");
    expect(html).toMatch(/disabled=""[^>]*>Send request/);
  });
  it("the same identity sees its own saved original", () => {
    expect(render(seeded())).toContain(SECRET);
  });

  it("switching tenant, user or role never presents the prior snapshot", () => {
    for (const next of [
      me("tB", "uOwner", "owner"),
      me("tA", "uFd", "owner"),
      me("tA", "uOwner", "front_desk"),
    ]) {
      session.value = { data: next };
      const html = render(seeded());
      expect(html).not.toContain(SECRET);
      expect(html).not.toContain("addr-A");
    }
  });

  it("a failed new-session fetch is not treated as the old identity", () => {
    session.value = { isError: true, data: me("tA", "uOwner", "owner") };
    expect(identityFromSession(session.value as never)).toBeNull();
    expect(render(seeded())).not.toContain(SECRET);
  });

  it("central purge removes every foreign receipt/finance query and mutation result", () => {
    const qc = seeded();
    qc.getMutationCache().build(qc, { mutationKey: ["receipt-controls", A, "request", "dep-1"] });
    qc.getMutationCache().build(qc, { mutationKey: ["other"] });
    purgeSensitiveReceiptData(qc, "tB:uX:owner");
    const left = qc
      .getQueryCache()
      .getAll()
      .map((q) => q.queryKey[0]);
    expect(left).not.toContain("receipt-controls");
    expect(left).not.toContain("financial-reporting");
    expect(
      qc
        .getMutationCache()
        .getAll()
        .map((m) => m.options.mutationKey?.[0]),
    ).toEqual(["other"]);
  });

  it("purge keeps the current identity's data; null identity removes everything", () => {
    const qc = seeded();
    purgeSensitiveReceiptData(qc, A);
    expect(qc.getQueryData(receiptControlsKey(A, "queue"))).toBeDefined();
    purgeSensitiveReceiptData(qc, null);
    expect(qc.getQueryCache().getAll()).toHaveLength(0);
  });
});
