import { it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReceiptProofDiagnostics } from "../../components/ReceiptUpdateProofPanel";
import type { ProofReport } from "../receipt-update-proof";
const report: ProofReport = {
  caseId: "test",
  companyName: "Test",
  receiptId: "test",
  docCode: "OR2610/002",
  documentDate: "2026-10-10",
  beforeCents: 5000,
  afterCents: 6500,
  packageHash: "test",
  sourceReference: "test",
  expiresAt: 1,
  outcome: "needs_review",
  journalVerified: false,
  conditionalWrite: "not_proven",
  reservationCount: 1,
  durationMs: 10,
};
it("tells the Owner when the historical attempt details were not recorded", () => {
  const html = renderToStaticMarkup(createElement(ReceiptProofDiagnostics, { report }));
  expect(html).toContain("Earlier attempt details were not recorded");
  expect(html).not.toContain("Update call started");
});
it("shows a failed Update response separately from an actual RM50 readback", () => {
  const html = renderToStaticMarkup(
    createElement(ReceiptProofDiagnostics, {
      report: {
        ...report,
        attempt: {
          stage: "update",
          dispatch: "attempted",
          reason: "n3_response_rejected",
          httpStatus: 409,
          envelopeCode: "0051",
          durationMs: 10,
        },
        readback: { outcome: "mismatch", observedCents: 5000, reason: "readback_mismatch" },
      },
    }),
  );
  expect(html).toContain("HTTP 409");
  expect(html).toContain("0051");
  expect(html).toContain("RM50.00");
  expect(html).toContain("do not resend");
});
