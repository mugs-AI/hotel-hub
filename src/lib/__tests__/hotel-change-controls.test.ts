import { describe, expect, it } from "vitest";
import { defaultChangePolicy, classifyReceiptChanges, routeChange } from "../hotel-change-controls";
import { receiptSnapshot } from "./fixtures/receipt-controls";

describe("independent approval controls", () => {
  it("requires deposit approval but permits existing local contact editing by default", () => {
    const policy = defaultChangePolicy();
    expect(routeChange("owner", "n3_receipt", { deposit: true, contact: false }, policy)).toBe(
      "approval",
    );
    expect(
      routeChange("front_desk", "folio_bill_to", { deposit: false, contact: true }, policy),
    ).toBe("direct");
  });
  for (const depositApprovalRequired of [false, true])
    for (const contactApprovalRequired of [false, true]) {
      const p = { revision: "1", depositApprovalRequired, contactApprovalRequired };
      for (const role of ["owner", "front_desk"] as const) {
        it(`${role} amount routing for deposit=${depositApprovalRequired} contact=${contactApprovalRequired}`, () => {
          expect(routeChange(role, "n3_receipt", { deposit: true, contact: false }, p)).toBe(
            depositApprovalRequired ? "approval" : role === "owner" ? "direct" : "owner_execution",
          );
        });
        it(`${role} combined changes obey either approval requirement ${depositApprovalRequired}/${contactApprovalRequired}`, () => {
          expect(routeChange(role, "n3_receipt", { deposit: true, contact: true }, p)).toBe(
            depositApprovalRequired || contactApprovalRequired
              ? "approval"
              : role === "owner"
                ? "direct"
                : "owner_execution",
          );
        });
        it(`${role} contact routing does not inherit deposit policy ${depositApprovalRequired}/${contactApprovalRequired}`, () => {
          expect(routeChange(role, "folio_bill_to", { deposit: false, contact: true }, p)).toBe(
            contactApprovalRequired ? "approval" : "direct",
          );
          expect(routeChange(role, "n3_receipt", { deposit: false, contact: true }, p)).toBe(
            contactApprovalRequired ? "approval" : role === "owner" ? "direct" : "owner_execution",
          );
        });
      }
    }
  it("refuses Housekeeper access even to a no-op", () => {
    expect(() =>
      routeChange(
        "housekeeper",
        "n3_receipt",
        { deposit: false, contact: false },
        defaultChangePolicy(),
      ),
    ).toThrow("forbidden");
  });
  it("does not create a proposal for unchanged canonical values", () => {
    const original = receiptSnapshot();
    const categories = classifyReceiptChanges(original, {
      kind: "correction",
      amountCents: original.amountCents,
      accountId: original.paymentLines[0]!.accountId.toUpperCase(),
      contact: original.contact,
    });
    expect(categories).toEqual({ deposit: false, contact: false });
    expect(routeChange("owner", "n3_receipt", categories, defaultChangePolicy())).toBe("no_change");
  });
  it("classifies changed payment account as a deposit change", () => {
    const original = receiptSnapshot();
    expect(
      classifyReceiptChanges(original, {
        kind: "correction",
        amountCents: original.amountCents,
        accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        contact: original.contact,
      }),
    ).toEqual({ deposit: true, contact: false });
  });
  it("classifies amount and contact together without splitting", () => {
    const original = receiptSnapshot();
    expect(
      classifyReceiptChanges(original, {
        kind: "correction",
        amountCents: 6500,
        accountId: original.paymentLines[0]!.accountId,
        contact: { ...original.contact, remark3: "0123456789" },
      }),
    ).toEqual({ deposit: true, contact: true });
  });
  it("does not route void proposals into automatic correction", () => {
    expect(() => classifyReceiptChanges(receiptSnapshot(), { kind: "void" })).toThrow(
      "automation_unavailable",
    );
  });
});
