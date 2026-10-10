import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { JournalCaptureCard } from "../../routes/settings_.n3-financial-verification";
import type { JournalCaptureReport } from "../n3-financial-journals.server";

const capture: JournalCaptureReport = {
  status: "partial",
  cap: 12,
  requested: 13,
  performed: 12,
  captured: 11,
  sourceIncomplete: true,
  truncated: true,
  note: "Captured responses only; posting correctness is not verified.",
  evidence: [
    {
      resource: "cash_sales",
      id: "synthetic-id",
      docCode: "CS-SYNTHETIC",
      endpoint: "/api/CashSales/GLPosting",
      method: "GET",
      timestamp: "2026-10-08T10:00:00Z",
      httpStatus: 200,
      envelopeCode: "0000",
      status: "captured",
      durationMs: 5,
      responseSample: { code: "0000", data: [{ id: "9223372036854775807" }] },
      sampleTruncated: false,
    },
  ],
};
it("shows partial coverage and sanitized evidence without asserting posting correctness", () => {
  const html = renderToStaticMarkup(createElement(JournalCaptureCard, { capture }));
  expect(html).toContain("Partial capture");
  expect(html).toContain("11 of 13");
  expect(html).toContain("posting correctness is not verified");
  expect(html).toContain("Show sanitized journal evidence");
  expect(html).toContain("9223372036854775807");
  expect(html).not.toMatch(/Live N3 Confirmed|Ready to post|<button/i);
});
it.each(["not_requested", "unavailable", "unauthorized"] as const)(
  "does not mark %s as successful financial verification",
  (status) => {
    const html = renderToStaticMarkup(
      createElement(JournalCaptureCard, {
        capture: { ...capture, status, performed: 0, captured: 0, evidence: [] },
      }),
    );
    expect(html).toContain("GL journal capture");
    expect(html).not.toMatch(/Live N3 Confirmed|Ready to post|<button/i);
  },
);
it("keeps older exports without journal capture usable", () => {
  expect(renderToStaticMarkup(createElement(JournalCaptureCard, {}))).toBe("");
});
