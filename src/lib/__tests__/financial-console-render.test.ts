import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { KnockoffCard } from "../../routes/settings_.n3-financial-verification";

it("shows Mismatch for a known customer conflict even when the document UUID matches", () => {
  const html = renderToStaticMarkup(
    createElement(KnockoffCard, {
      data: {
        comparisons: {
          refundToOr: [],
          orToCashMemo: [
            {
              receiptId: "receipt",
              receiptDocNo: "OR-SYNTHETIC",
              docType: "INV",
              docId: "bill",
              docNo: null,
              docCode: "CS-SYNTHETIC",
              appliedAmount: 60.01,
              candidateCashSalesId: "bill",
              candidateCashSalesDocNo: "CS-SYNTHETIC",
              candidateCashSalesDocCode: "CS-SYNTHETIC",
              sameUuid: true,
              docNoAgrees: null,
              customerMatch: false,
              correlation: "mismatch",
              evidenceLabel: "Mismatch",
            },
          ],
        },
      },
    }),
  );
  expect(html).toContain("Mismatch");
  expect(html).not.toContain("Live N3 Confirmed");
  expect(html).toContain("60.01");
});
