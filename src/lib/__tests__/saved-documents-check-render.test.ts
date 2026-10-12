import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SavedDocumentCheckResults } from "../../components/SavedDocumentsCheckPanel";
import type { SavedDocumentCheck } from "../saved-documents-check";
const result: SavedDocumentCheck = {
  tenantId: "tenant",
  reservationId: "reservation",
  intentId: "intent",
  status: "confirmed",
  code: "saved_document_observations_confirmed",
  checkedAt: "2026-10-12T04:00:00Z",
  observations: 1,
  persistenceProven: false,
  billOutstandingCents: 50000,
  documents: [{ id: "saved-id", code: "CS-SYNTHETIC", kind: "bill" }],
  attempts: [],
  responses: [],
  checks: [{ name: "journal", status: "observed", code: "saved_document_observations_confirmed" }],
};
describe("saved document recovery rendering", () => {
  it("observed_journal_is_not_persisted_or_checkout_authority", () => {
    const html = renderToStaticMarkup(
      createElement(SavedDocumentCheckResults, {
        result,
        bookingReference: "BK-SYNTHETIC",
        currency: "MYR",
      }),
    );
    expect(html).toContain("500.00");
    expect(html).toContain("Observed bill outstanding");
    expect(html).toContain("does not prove persistence");
    expect(html).not.toContain("Checkout confirmed");
    expect(html).toContain("CS-SYNTHETIC");
  });
  it.each([
    ["unauthorized", "n3_session_expired", "Reopen HotelHub"],
    ["waiting", "verification_waiting", "Waiting for verification"],
    ["needs_review", "settlement_scope_mismatch", "exact saved documents"],
  ] as const)(
    "%s hides stale amounts and keeps same-document guidance",
    (status, code, message) => {
      const html = renderToStaticMarkup(
        createElement(SavedDocumentCheckResults, {
          result: { ...result, status, code },
          bookingReference: "BK-SYNTHETIC",
          currency: "MYR",
        }),
      );
      expect(html).not.toContain("500.00");
      expect(html).toContain(message);
      expect(html).toContain("do not collect again");
      expect(html).not.toContain("Apply matching");
    },
  );
});
