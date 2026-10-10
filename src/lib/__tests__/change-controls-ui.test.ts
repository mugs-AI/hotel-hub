import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChangeControlOptions } from "../../components/ChangeControlSettings";
import { ReceiptRequestCard } from "../../components/ReceiptApprovalQueue";
import { BillToChangeCard } from "../../components/BillToApprovalQueue";
import type { ReceiptAutomationDTO } from "../receipt-automation";
import { RECEIPT_50, PROPOSAL_65 } from "./fixtures/receipt-automation";
const request: ReceiptAutomationDTO = {
  id: "test",
  reservationId: "r",
  bookingReference: "BK-TEST",
  depositId: "d",
  reason: "guest no small notes",
  requestedByLabel: "Front Desk",
  requestedAt: "2026-10-03T00:00:00Z",
  state: "pending",
  version: 1,
  original: RECEIPT_50,
  proposal: PROPOSAL_65,
  comparison: {
    fields: [
      { label: "Amount", original: "RM50.00", requested: "RM65.00" },
      { label: "Phone", original: "0100000000", requested: "0110000000" },
    ],
    depositDeltaCents: 1500,
    balanceDeltaCents: -1500,
  },
  executionMode: "direct",
  decidedByLabel: null,
  decidedAt: null,
  selfApproved: false,
  canApprove: true,
  canReject: true,
  canVerify: false,
  canRecover: false,
  outcomeMessage: null,
  alert: null,
  automation: {
    generation: 2,
    policy: { revision: "0", depositApprovalRequired: true, contactApprovalRequired: false },
    categories: { deposit: true, contact: false },
    authorizationKind: null,
    authorizedBy: null,
    authorizedAt: null,
  },
  canApply: false,
  canCheckResult: false,
};
describe("change-control UI contracts", () => {
  it("renders independent default ON/OFF approval switches, unavailable and non-Owner disabled", () => {
    const html = renderToStaticMarkup(
      createElement(ChangeControlOptions, {
        policy: request.automation!.policy,
        available: true,
        owner: true,
        onChange: () => {},
      }),
    );
    expect(html).toContain("Deposit changes require Admin approval");
    expect(html).toContain("Billing contact changes require Admin approval");
    expect(html.match(/checked=/g)).toHaveLength(1);
    const blocked = renderToStaticMarkup(
      createElement(ChangeControlOptions, {
        policy: request.automation!.policy,
        available: false,
        owner: false,
        onChange: () => {},
      }),
    );
    expect(blocked.match(/disabled=/g)).toHaveLength(2);
    expect(blocked).toContain("not installed");
  });
  it("shows full comparison and single Approve without Review/acknowledgement or Verify", () => {
    const html = renderToStaticMarkup(createElement(ReceiptRequestCard, { r: request }));
    for (const text of ["RM50.00", "RM65.00", "0100000000", "0110000000", "Approve"])
      expect(html).toContain(text);
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toMatch(/>Review</);
    expect(html).not.toContain("Verify N3 change");
  });
  it("distinguishes Applying and GET-only uncertainty actions", () => {
    const busy = renderToStaticMarkup(
      createElement(ReceiptRequestCard, { r: request, busy: true }),
    );
    expect(busy).toContain("Applying…");
    const uncertain = renderToStaticMarkup(
      createElement(ReceiptRequestCard, {
        r: {
          ...request,
          state: "needs_review",
          canApprove: false,
          canReject: false,
          canCheckResult: true,
        },
      }),
    );
    expect(uncertain).toContain("Check N3 result");
    expect(uncertain).not.toMatch(/>Approve</);
  });
  it("local contact proposal shows separate Original and Proposed; no N3 Verify", () => {
    const original = { name: "Original", company: "", address: "", phone: "", email: "" };
    const html = renderToStaticMarkup(
      createElement(BillToChangeCard, {
        request: {
          id: "p",
          reservationId: "r",
          bookingReference: "BK-TEST",
          version: 1,
          state: "pending",
          original,
          requested: { ...original, name: "Proposed" },
          reason: "company",
          requestedByLabel: "Front Desk",
          requestedAt: "2026-10-03T00:00:00Z",
          canApprove: true,
          canReject: true,
        },
      }),
    );
    expect(html).toContain("Original");
    expect(html).toContain("Proposed");
    expect(html).toContain("Approve");
    expect(html).not.toContain("Verify");
  });
});
