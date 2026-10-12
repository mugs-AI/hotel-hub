import { describe, expect, it } from "vitest";
import { presentSourceBill, renderSourceBillHtml } from "../source-billing-presentation";
import { settlementFixture } from "./fixtures/settlement";
import { snapshotDigest } from "../settlement-snapshot.server";
import type { BillingLegSnapshot } from "../source-billing";
const legId = "44444444-4444-4444-8444-444444444444";
function leg(kind: "source_room" | "guest" = "source_room", amount = 30000): BillingLegSnapshot {
  const { digest: _d, ...facts } = settlementFixture({
    customerId: kind === "source_room" ? 8 : 7,
    totalCents: amount,
    receipts: [],
    lines: [
      {
        ...settlementFixture().lines[0],
        unitCents: amount,
        subtotalCents: amount,
        totalCents: amount,
        description: "Raw room RM300.00 should not leak",
      },
    ],
  });
  return {
    legId,
    kind,
    customerId: facts.customerId,
    collectionMode: kind === "guest" ? "guest" : "source",
    documentTitle: kind === "guest" ? "Sales Invoice" : "Agoda Sales",
    itemDescription: kind === "guest" ? "Guest extras" : "Accommodation handled by Agoda",
    showPrices: kind === "guest",
    snapshot: { ...facts, digest: snapshotDigest(facts) },
  };
}
const verified = {
  legId,
  snapshotDigest: leg().snapshot.digest,
  hhNumber: "SI261000001",
  n3Number: "INV2610/001",
  n3Id: "99999999-9999-4999-8999-999999999999",
  checkedAt: "2026-10-12T00:00:00Z",
  status: "issued" as const,
  documentType: "sales_invoice" as const,
};
describe("source billing audience-specific projection and print", () => {
  it("guest source copy contains no room price, tax, unit price, total or raw description", () => {
    const dto = presentSourceBill(leg(), verified, "guest");
    const raw = JSON.stringify(dto),
      html = renderSourceBillHtml(dto);
    expect(dto.title).toBe("Agoda Sales");
    expect(dto.showPrices).toBe(false);
    expect(raw).not.toMatch(/30000|300\.00|Raw room/);
    expect(html).not.toMatch(/300\.00|Raw room|Unit price|Total|Tax/);
    expect(dto.rows[0]).toMatchObject({
      description: "Accommodation handled by Agoda",
      unitPrice: null,
      subtotal: null,
      tax: null,
      total: null,
    });
    expect(dto.documentKind).toBe("accommodation_statement");
  });
  it.each([8000, 4000])(
    "guest extras retain the ordinary invoice and visible %i cents",
    (amount) => {
      const l = leg("guest", amount),
        v = { ...verified, snapshotDigest: l.snapshot.digest };
      const dto = presentSourceBill(l, v, "guest");
      expect(dto.title).toBe("Sales Invoice");
      expect(dto.total).toBe(amount / 100);
      expect(dto.showPrices).toBe(true);
      expect(renderSourceBillHtml(dto)).toContain((amount / 100).toFixed(2));
    },
  );
  it("accounting copy retains full room and tax despite source guest suppression", () => {
    const l = leg();
    l.snapshot.lines[0].subtotalCents = 28000;
    l.snapshot.lines[0].unitCents = 28000;
    l.snapshot.lines[0].taxCents = 2000;
    const { digest: _d, ...facts } = l.snapshot;
    l.snapshot.digest = snapshotDigest(facts);
    const dto = presentSourceBill(
      l,
      { ...verified, snapshotDigest: l.snapshot.digest },
      "accounting",
    );
    expect(dto.rows[0]).toMatchObject({ subtotal: 280, tax: 20, total: 300 });
    expect(dto.total).toBe(300);
    expect(dto.showPrices).toBe(true);
    expect(renderSourceBillHtml(dto)).toContain("300.00");
  });
  it("unverified documents are labelled preparation only and suppress supplied final identity", () => {
    const dto = presentSourceBill(leg(), null, "guest");
    expect(dto.status).toBe("unavailable");
    expect(dto.document).toBeNull();
    expect(renderSourceBillHtml(dto)).toContain("Preparation only");
    const alien = presentSourceBill(leg(), { ...verified, legId: "other" }, "guest");
    expect(alien.document).toBeNull();
    const mismatch = presentSourceBill(leg(), { ...verified, snapshotDigest: "bad" }, "guest");
    expect(mismatch.document).toBeNull();
  });
  it("custom title never changes the formal accounting document type", () => {
    const dto = presentSourceBill(leg(), { ...verified, documentType: "cash_sale" }, "accounting");
    expect(dto.title).toBe("Cash Sale");
    expect(dto.configuredTitle).toBe("Agoda Sales");
    expect(dto.document?.type).toBe("cash_sale");
  });
  it("escapes guest-facing HTML and prints dates DD/MM/YYYY", () => {
    const l = leg();
    l.itemDescription = "<script>alert('x')</script>";
    const dto = presentSourceBill(l, verified, "guest"),
      html = renderSourceBillHtml(dto);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("08/10/2026");
  });
  it("returned DTO has no mutable snapshot, customer evidence or unrelated sibling totals", () => {
    const l = leg(),
      dto = presentSourceBill(l, verified, "guest");
    l.itemDescription = "Changed source default";
    l.snapshot.totalCents = 1;
    expect(dto.rows[0].description).toBe("Accommodation handled by Agoda");
    expect(Object.isFrozen(dto.rows[0])).toBe(true);
    expect(Object.keys(dto)).not.toContain("snapshot");
    expect(Object.keys(dto)).not.toContain("mappingEvidence");
  });
});
