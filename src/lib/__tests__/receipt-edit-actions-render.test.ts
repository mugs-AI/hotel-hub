import { createElement, type ReactNode, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DepositDTO } from "../deposits-client";
import type { ReceiptControlRequestDTO } from "../receipt-controls";
import { receiptSnapshot } from "./fixtures/receipt-controls";

const session = vi.hoisted(() => ({ role: "owner", authenticated: true, voided: false }));
vi.mock("@/lib/session-client", () => ({
  useSessionMe: () => ({
    data: {
      authenticated: session.authenticated,
      tenant: { tenantId: "test-tenant" },
      user: { n3UserKey: "test-user" },
      role: session.role,
    },
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to: string }) =>
    createElement("a", { ...props, href: to }, children),
}));
vi.mock("@/lib/workspace-context", () => ({
  useWorkspaceDraft: (_name: string, initial: unknown) => useState(initial),
}));
vi.mock("@/lib/deposits-client", async (original) => ({
  ...(await original<typeof import("../deposits-client")>()),
  useReservationDeposits: () => ({
    data: {
      deposits: [
        {
          id: "test-deposit",
          status: "posted",
          amount: 50,
          currency: "MYR",
          n3DocCode: "OR-TEST/001",
          n3ReceiptId: "11111111-1111-4111-8111-111111111111",
          customerLabel: "Test guest",
          accountLabel: "Test bank",
          paymentLines: [],
          effectiveState: session.voided ? "voided" : "active",
          description: "Test deposit",
          createdByLabel: "Test staff",
          createdAt: "2026-10-01T00:00:00Z",
          errorCode: null,
        } satisfies DepositDTO,
      ],
      capability: { canCreate: false },
      summary: { total: 50, currency: "MYR" },
    },
  }),
  usePaymentAccounts: () => ({ data: { accounts: [] } }),
  useCreateDeposit: () => ({ isPending: false }),
  useReconcileDeposit: () => ({ isPending: false }),
  useDepositPreview: () => ({ data: undefined }),
}));

import { DepositsCard } from "@/components/DepositsCard";
import { receiptControlsKey } from "../receipt-controls-client";

function request(state: ReceiptControlRequestDTO["state"]): ReceiptControlRequestDTO {
  const original = receiptSnapshot();
  return {
    id: "test-request",
    reservationId: "test-reservation",
    depositId: "test-deposit",
    bookingReference: "BK-TEST",
    reason: "Entry correction",
    requestedByLabel: "Test staff",
    requestedAt: "2026-10-01T00:00:00Z",
    state,
    version: 12,
    original,
    proposal: {
      kind: "correction",
      amountCents: 6500,
      accountId: original.paymentLines[0]!.accountId,
      contact: original.contact,
    },
    comparison: { fields: [], depositDeltaCents: 1500, balanceDeltaCents: -1500 },
    executionMode: "manual",
    decidedByLabel: null,
    decidedAt: null,
    selfApproved: false,
    canApprove: false,
    canReject: true,
    canVerify: true,
    canRecover: false,
    outcomeMessage: null,
    alert: null,
  };
}
function render(
  opts: {
    requests?: ReceiptControlRequestDTO[];
    loading?: boolean;
    error?: boolean;
    refreshing?: boolean;
    canRequest?: boolean;
  } = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  const key = receiptControlsKey(
    `test-tenant:test-user:${session.role}`,
    "reservation:test-reservation",
  );
  if (!opts.loading) {
    client.setQueryData(key, { requests: opts.requests ?? [], total: 0, nextOffset: null });
  }
  if (opts.error) {
    client
      .getQueryCache()
      .find({ queryKey: key })!
      .setState({
        status: "error",
        error: new Error("Unavailable request list"),
      });
  }
  if (opts.refreshing) {
    client.getQueryCache().find({ queryKey: key })!.setState({ fetchStatus: "fetching" });
  }
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(DepositsCard, {
        reservationId: "test-reservation",
        canView: true,
        canCreate: false,
        canRequestReceiptChange: opts.canRequest ?? true,
        eligible: true,
      }),
    ),
  );
}
beforeEach(() => {
  session.role = "owner";
  session.authenticated = true;
  session.voided = false;
});
describe("receipt edit action and existing-request recovery", () => {
  it("offers a clearly labelled edit for a posted receipt with no open request", () => {
    const html = render();
    expect(html).toContain(">Edit receipt</button>");
    expect(html).not.toMatch(/disabled=""[^>]*>Edit receipt/);
    expect(html).toContain("Request void");
  });
  it("keeps an open manual correction visible and blocks a second edit with same-receipt guidance", () => {
    const html = render({ requests: [request("needs_review")] });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Edit receipt<\/button>/);
    expect(html).toContain("Needs review");
    expect(html).toContain("same receipt in N3");
    expect(html).toContain("Verify N3 change");
    expect(html).toContain('href="/"');
    expect(html).toContain("Review on Dashboard");
    expect(html).not.toContain("Request void");
    expect(html).toContain("RM 50.00");
    expect(html).not.toContain("RM 65.00");
  });
  it("guides Front Desk to the Owner while an edit is under review", () => {
    session.role = "front_desk";
    const html = render({ requests: [request("needs_review")] });
    expect(html).toContain("Ask the Owner");
    expect(html).not.toContain("Review on Dashboard");
    expect(html).toMatch(/disabled=""[^>]*>Edit receipt/);
  });
  it.each(["pending", "applying", "failed"] as const)(
    "retains a blocked edit and Dashboard guidance for an existing %s request",
    (state) => {
      const html = render({ requests: [request(state)] });
      expect(html).toMatch(/disabled=""[^>]*>Edit receipt/);
      expect(html).toContain("Review on Dashboard");
      expect(html).not.toContain("Request void");
    },
  );
  it("waits for the request list before offering another correction", () => {
    const html = render({ loading: true });
    expect(html).toMatch(/disabled=""[^>]*>Edit receipt/);
    expect(html).toContain("Checking receipt requests");
    expect(html).not.toContain("Request void");
  });
  it("shows a recoverable read error instead of a missing or enabled edit action", () => {
    const html = render({ error: true });
    expect(html).toMatch(/disabled=""[^>]*>Edit receipt/);
    expect(html).toContain("Retry receipt requests");
    expect(html).not.toContain("Request void");
  });
  it("holds new edits while refreshing a cached empty request list", () => {
    const html = render({ refreshing: true });
    expect(html).toMatch(/disabled=""[^>]*>Edit receipt/);
    expect(html).toContain("Checking receipt requests");
    expect(html).not.toContain("Request void");
  });
  it("keeps the known open request and recovery route visible after a failed refresh", () => {
    const html = render({ requests: [request("needs_review")], error: true });
    expect(html).toContain("Needs review");
    expect(html).toContain("same receipt in N3");
    expect(html).toContain("Review on Dashboard");
    expect(html).toContain("Could not refresh receipt requests");
    expect(html).toContain("Retry receipt requests");
    expect(html).toMatch(/disabled=""[^>]*>Edit receipt/);
    expect(html).not.toContain("Request void");
  });
  it.each([{ loading: true }, { error: true }, { canRequest: false }])(
    "keeps a known voided receipt's accounting warning with request state %j",
    (opts) => {
      session.voided = true;
      const html = render(opts);
      expect(html).toContain("Voided in N3 — not counted");
      expect(html).not.toContain("Edit receipt");
      expect(html).not.toContain("Request void");
    },
  );
  it("does not offer edit or review actions without permission", () => {
    const html = render({ canRequest: false });
    expect(html).not.toContain("Edit receipt");
    expect(html).not.toContain("Review on Dashboard");
  });
  it("does not offer edit or review actions after losing the signed-in identity", () => {
    session.authenticated = false;
    const html = render();
    expect(html).not.toContain("Edit receipt");
    expect(html).not.toContain("Review on Dashboard");
  });
});
