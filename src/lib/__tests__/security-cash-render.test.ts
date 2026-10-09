import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SecurityCashLedger, SecurityReceipt } from "@/components/SecurityCashCard";
import { SecurityReportView } from "@/components/SecurityCashReport";
import type { SecurityBooking, SecurityHolding, SecurityReport } from "../security-cash";
const h: SecurityHolding = {
  id: "h",
  reservationId: "r",
  roomStayId: "room",
  receiptNumber: "SD261000001",
  originalCents: 5000,
  payer: "Guest",
  recipient: "Guest",
  storage: "Envelope A",
  roomNumber: "101",
  bookingReference: "BK1",
  terms: "Cash held separately",
  waived: false,
  inspectionClear: true,
  openCase: false,
  version: "v",
  createdAt: "2026-10-09T08:00:00Z",
  createdBy: "staff",
  heldCents: 5000,
  returnableCents: 3000,
  pendingDispositionCents: 2000,
  pendingReturn: { id: "op", cents: 3000, recipient: "Guest", reservedBy: "staff" },
};
const state: SecurityBooking = {
  available: true,
  enabled: false,
  policy: { amountCents: 5000, required: true, terms: "Cash", version: "v" },
  holdings: [h],
};
it("keeps pending return visible when collection is off", () => {
  const html = renderToStaticMarkup(
    createElement(SecurityCashLedger, {
      state,
      owner: false,
      onAction: () => {},
      busy: false,
      rooms: [],
    }),
  );
  expect(html).toContain("RM 30.00");
  expect(html).toContain("Pending cash handover");
  expect(html).toContain("Confirm cash handed");
  expect(html).not.toContain("Collect security cash");
  expect(html).not.toContain("N3 Print");
});
it("prints local Copy receipt without N3 or ID image data", () => {
  const html = renderToStaticMarkup(
    createElement(SecurityReceipt, {
      holding: h,
      property: { name: "Hotel", phone: "123", address: "Ipoh", email: "" },
    }),
  );
  expect(html).toContain("Security Deposit Receipt");
  expect(html).toContain("Copy");
  expect(html).toContain("SD261000001");
  expect(html).toContain("RM 50.00");
  expect(html).toContain("held separately from room payment");
});
it("prints physical closing cash distinct from outstanding guest money", () => {
  const report: SecurityReport = {
    from: "2026-10-01",
    asAt: "2026-11-01",
    openingCents: 5000,
    collectionsCents: 0,
    returnsCents: 3000,
    transfersCents: 0,
    adjustmentsCents: 0,
    closingCents: 2000,
    holdings: [{ ...h, heldCents: 2000, returnableCents: 0, pendingReturn: null, openCase: true }],
    events: [],
  };
  const html = renderToStaticMarkup(createElement(SecurityReportView, { report }));
  expect(html).toContain("RM 20.00");
  expect(html).toContain("Unresolved");
  expect(html).toContain("Opening held");
  expect(html).not.toContain("Receive payment");
});
it("saved statements print actual per-envelope discrepancies even when the total matches", () => {
  const report: SecurityReport = {
    from: "2026-10-01",
    asAt: "2026-11-01",
    openingCents: 0,
    collectionsCents: 10000,
    returnsCents: 0,
    transfersCents: 0,
    adjustmentsCents: 0,
    closingCents: 10000,
    holdings: [h, { ...h, id: "h2", receiptNumber: "SD261000002" }],
    events: [],
  };
  const statement = {
    id: "s",
    version: "v",
    snapshot: report,
    counts: [
      { holdingId: h.id, cents: 4000 },
      { holdingId: "h2", cents: 6000 },
    ],
    countedCents: 10000,
    varianceCents: 0,
    firstSigner: "staff",
    secondSigner: null,
    singlePerson: true,
    note: "Count",
    storage: "Safe",
    status: "awaiting_owner_review",
  };
  const html = renderToStaticMarkup(createElement(SecurityReportView, { report, statement }));
  expect(html).toContain("Actual envelope count");
  expect(html).toContain("Envelope variance");
  expect(html).toContain("RM 40.00");
  expect(html).toContain("RM 60.00");
  expect(html).toContain("RM -10.00");
});
