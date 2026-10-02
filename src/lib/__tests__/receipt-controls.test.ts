import { describe, expect, it } from "vitest";
import {
  canTransitionReceiptControl,
  compareReceiptControl,
  validateReceiptControlProposal,
  ReceiptControlError,
  type ReceiptControlProposal,
} from "../receipt-controls";
import { formatReceiptContact } from "../receipt-contact";
import { receiptSnapshot } from "./fixtures/receipt-controls";

const ACC2 = "44444444-4444-4444-8444-444444444444";
const contactInput = (o: Record<string, string> = {}) => ({
  name: "Test Guest",
  company: "",
  address: "1 Test Street",
  phone: "0100000000",
  email: "guest@example.test",
  ...o,
});
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as ReceiptControlError).code;
  }
  return "no_error";
};

describe("receipt control comparison", () => {
  it("shows the RM50 to RM80 deposit and balance differences", () => {
    const original = receiptSnapshot();
    const proposal: ReceiptControlProposal = {
      kind: "correction",
      amountCents: 8000,
      accountId: original.paymentLines[0]!.accountId,
      contact: original.contact,
    };
    const cmp = compareReceiptControl(original, proposal);
    expect(cmp).toMatchObject({ depositDeltaCents: 3000, balanceDeltaCents: -3000 });
    expect(cmp.fields).toContainEqual({
      label: "Amount",
      original: "RM50.00",
      requested: "RM80.00",
    });
    expect(compareReceiptControl(original, { kind: "void" })).toMatchObject({
      depositDeltaCents: -5000,
      balanceDeltaCents: 5000,
    });
  });
  it("lists only changed fields, including account and contact", () => {
    const original = receiptSnapshot();
    const cmp = compareReceiptControl(original, {
      kind: "correction",
      amountCents: 5000,
      accountId: ACC2,
      contact: { ...original.contact, remark3: "0199999999" },
    });
    expect(cmp.fields.map((f) => f.label)).toEqual(["Deposit to", "Phone"]);
  });
});

describe("proposal validation", () => {
  const original = receiptSnapshot();
  const base = { kind: "correction", amount: 80, accountId: ACC2, contact: contactInput() };
  it("accepts a valid correction in integer cents", () => {
    expect(validateReceiptControlProposal(base, original)).toMatchObject({
      kind: "correction",
      amountCents: 8000,
      accountId: ACC2,
    });
    expect(validateReceiptControlProposal({ kind: "void" }, original)).toEqual({ kind: "void" });
  });
  it.each([0, -1, 10.005, Number.MAX_SAFE_INTEGER + 2, 1_000_000.01, "80", NaN])(
    "rejects amount %s",
    (amount) => {
      expect(code(() => validateReceiptControlProposal({ ...base, amount }, original))).toBe(
        "invalid_amount",
      );
    },
  );
  it("rejects missing account", () => {
    expect(code(() => validateReceiptControlProposal({ ...base, accountId: "" }, original))).toBe(
      "invalid_account",
    );
  });
  it.each([
    [{ matchingState: "matched" as const }],
    [{ matchingState: "refunded" as const }],
    [{ matchingState: "unknown" as const }],
    [{ documentState: "unknown" as const }],
    [{ documentState: "voided" as const }],
  ])("rejects a restricted original %o", (o) => {
    expect(code(() => validateReceiptControlProposal(base, receiptSnapshot(o)))).toBe(
      "receipt_restricted",
    );
  });
  it("rejects unchanged proposals", () => {
    expect(
      code(() =>
        validateReceiptControlProposal(
          {
            kind: "correction",
            amount: 50,
            accountId: original.paymentLines[0]!.accountId,
            contact: contactInput(),
          },
          original,
        ),
      ),
    ).toBe("proposal_unchanged");
  });
  it.each(["customerId", "currency", "tenantId", "status", "approvedBy"])(
    "rejects client-supplied %s instead of copying it",
    (key) => {
      expect(code(() => validateReceiptControlProposal({ ...base, [key]: "x" }, original))).toBe(
        "unknown_field",
      );
    },
  );
  it("rejects multi-method originals for correction (manual review)", () => {
    const multi = receiptSnapshot({
      paymentLines: [
        { accountId: ACC2, code: "A", savedName: "A", amountCents: 2500 },
        {
          accountId: "55555555-5555-4555-8555-555555555555",
          code: "B",
          savedName: "B",
          amountCents: 2500,
        },
      ],
    });
    expect(code(() => validateReceiptControlProposal(base, multi))).toBe(
      "split_correction_unsupported",
    );
  });
});

describe("contact formatter keeps remark limits without truncation", () => {
  const a = (n: number) => "a".repeat(n);
  it.each([
    [100, 100, 0],
    [101, 100, 1],
    [200, 100, 100],
  ])("address length %i splits %i/%i", (n, r1, r2) => {
    const c = formatReceiptContact(contactInput({ address: a(n) }));
    expect([c.remark1.length, c.remark2.length]).toEqual([r1, r2]);
    expect(c.remark1 + c.remark2).toBe(a(n));
  });
  it("rejects 201 characters rather than truncating", () => {
    expect(code(() => formatReceiptContact(contactInput({ address: a(201) })))).toBe(
      "receipt_contact_too_long",
    );
    expect(code(() => formatReceiptContact(contactInput({ phone: a(101) })))).toBe(
      "receipt_contact_too_long",
    );
  });
  it("never splits a surrogate pair at the boundary", () => {
    const c = formatReceiptContact(contactInput({ address: a(99) + "😀" + a(10) }));
    expect(c.remark1).toBe(a(99));
    expect(c.remark2.startsWith("😀")).toBe(true);
  });
  it("puts company before guest name", () => {
    expect(formatReceiptContact(contactInput({ company: "Co" })).customerName).toBe(
      "Co, Test Guest",
    );
  });
});

describe("state transitions", () => {
  it("allows only the documented edges", () => {
    expect(canTransitionReceiptControl("pending", "approved_awaiting_n3")).toBe(true);
    expect(canTransitionReceiptControl("pending", "applied")).toBe(false);
    expect(canTransitionReceiptControl("approved_awaiting_n3", "applied")).toBe(false);
    expect(canTransitionReceiptControl("needs_review", "applied")).toBe(true);
    expect(canTransitionReceiptControl("applied", "rejected")).toBe(false);
    expect(canTransitionReceiptControl("rejected", "pending")).toBe(false);
    expect(canTransitionReceiptControl("failed", "needs_review")).toBe(true);
  });
});
