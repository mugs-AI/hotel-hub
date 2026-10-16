import { describe, expect, it, vi } from "vitest";
import { receivePaymentAndMatch, SavedPaymentMatchingError } from "../settlement-payment-sequence";
import type { SettlementView, SettlementStepInput } from "../settlement";
const receiptId = "33333333-3333-4333-8333-333333333333";
const accountId = "44444444-4444-4444-8444-444444444444";
function fixture() {
  const initial: SettlementView = {
    tenantId: "tenant",
    reservationId: "booking",
    intentId: "intent",
    snapshotDigest: "d".repeat(64),
    revision: "4",
    state: "awaiting_payment",
    currency: "MYR",
    bill: {
      id: "22222222-2222-4222-8222-222222222222",
      code: "CS",
      documentDate: "2026-10-15",
      totalCents: 100000,
      outstandingCents: 95000,
    },
    receipts: [],
    blockers: [],
    allowedActions: ["receive_balance"],
    verifiedAt: null,
  };
  const received: SettlementView = {
    ...structuredClone(initial),
    revision: "8",
    state: "balance_dispatched",
    allowedActions: ["apply_balance"],
    receipts: [
      {
        id: receiptId,
        code: "OR",
        documentDate: "2026-10-15",
        amountCents: 95000,
        allocatedCents: 0,
        remainderCents: 95000,
      },
    ],
  };
  const matched: SettlementView = {
    ...structuredClone(received),
    revision: "11",
    state: "settled",
    allowedActions: ["close"],
    bill: { ...initial.bill!, outstandingCents: 0 },
    receipts: [{ ...received.receipts[0], allocatedCents: 95000, remainderCents: 0 }],
  };
  const inputs: SettlementStepInput[] = [];
  const submit = vi.fn(async (input: SettlementStepInput) => {
    inputs.push(input);
    return input.action === "receive_balance" ? received : matched;
  });
  return {
    initial,
    received,
    matched,
    inputs,
    submit,
    lines: [{ accountId, amountCents: 95000 }],
    isCurrent: () => true,
  };
}
describe("explicit Receive Payment followed by one bounded matching request", () => {
  it("uses the saved receipt revision for matching without another receipt creation", async () => {
    const f = fixture();
    expect(await receivePaymentAndMatch(f.initial, f.lines, f)).toEqual(f.matched);
    expect(f.inputs).toEqual([
      {
        action: "receive_balance",
        intentId: "intent",
        expectedRevision: "4",
        paymentLines: f.lines,
      },
      { action: "apply_balance", intentId: "intent", expectedRevision: "8" },
    ]);
  });
  it("does not submit anything after leaving the booking", async () => {
    const f = fixture();
    f.isCurrent = () => false;
    expect(await receivePaymentAndMatch(f.initial, f.lines, f)).toEqual(f.initial);
    expect(f.inputs).toEqual([]);
  });
  it("does not match after the session or booking changes while receipt creation is pending", async () => {
    const f = fixture();
    let current = true;
    f.isCurrent = () => current;
    f.submit.mockImplementation(async (input) => {
      f.inputs.push(input);
      current = false;
      return f.received;
    });
    expect(await receivePaymentAndMatch(f.initial, f.lines, f)).toEqual(f.received);
    expect(f.inputs.map((i) => i.action)).toEqual(["receive_balance"]);
  });
  it.each(["tenantId", "reservationId", "intentId", "snapshotDigest", "currency"] as const)(
    "rejects a changed %s before the matching request",
    async (key) => {
      const f = fixture();
      Object.assign(f.received, { [key]: "foreign" });
      await expect(receivePaymentAndMatch(f.initial, f.lines, f)).rejects.toThrow();
      expect(f.inputs.map((i) => i.action)).toEqual(["receive_balance"]);
    },
  );
  it("retains a saved receipt and does not match when the server closes the allocation gate", async () => {
    const f = fixture();
    f.received.allowedActions = [];
    expect(await receivePaymentAndMatch(f.initial, f.lines, f)).toEqual(f.received);
    expect(f.inputs.map((i) => i.action)).toEqual(["receive_balance"]);
  });
  it("does not match an unknown receipt result", async () => {
    const f = fixture();
    f.received.blockers = ["settlement_identity_requires_review"];
    expect(await receivePaymentAndMatch(f.initial, f.lines, f)).toEqual(f.received);
    expect(f.inputs.map((i) => i.action)).toEqual(["receive_balance"]);
  });
  it.each(["missing", "wrong_amount", "already_allocated", "duplicate"])(
    "refuses %s receipt evidence before matching",
    async (mode) => {
      const f = fixture();
      if (mode === "missing") f.received.receipts = [];
      if (mode === "wrong_amount") f.received.receipts[0].amountCents = 95001;
      if (mode === "already_allocated") f.received.receipts[0].allocatedCents = 1;
      if (mode === "duplicate") f.received.receipts.push({ ...f.received.receipts[0] });
      await expect(receivePaymentAndMatch(f.initial, f.lines, f)).rejects.toBeInstanceOf(
        SavedPaymentMatchingError,
      );
      expect(f.inputs.map((i) => i.action)).toEqual(["receive_balance"]);
    },
  );
  it("marks a matching transport failure as a saved payment and never retries it", async () => {
    const f = fixture();
    const fault = new Error("lost reply");
    f.submit.mockImplementation(async (input) => {
      f.inputs.push(input);
      if (input.action === "apply_balance") throw fault;
      return f.received;
    });
    await expect(receivePaymentAndMatch(f.initial, f.lines, f)).rejects.toMatchObject({
      cause: fault,
    });
    expect(f.inputs.map((i) => i.action)).toEqual(["receive_balance", "apply_balance"]);
  });
  it("blocks a bypass of the deposit step before receipt creation", async () => {
    const f = fixture();
    f.initial.allowedActions = ["apply_deposits"];
    await expect(receivePaymentAndMatch(f.initial, f.lines, f)).rejects.toThrow();
    expect(f.inputs).toEqual([]);
  });
  it("refuses an altered payment total before creating a receipt", async () => {
    const f = fixture();
    f.lines[0].amountCents = 95001;
    await expect(receivePaymentAndMatch(f.initial, f.lines, f)).rejects.toThrow();
    expect(f.inputs).toEqual([]);
  });
  it("snapshots the original bill and intent before waiting for the saved receipt", async () => {
    const f = fixture();
    f.submit.mockImplementation(async (input) => {
      f.inputs.push(input);
      f.initial.intentId = "foreign";
      f.initial.bill!.id = "foreign";
      return input.action === "receive_balance" ? f.received : f.matched;
    });
    expect(await receivePaymentAndMatch(f.initial, f.lines, f)).toEqual(f.matched);
    expect(f.inputs[1]).toMatchObject({ intentId: "intent", expectedRevision: "8" });
  });
});

// Independent QA review counterexamples: a matching action alone cannot authorize
// continuation if the returned accounting facts contradict the reviewed step.
describe("saved-payment response consistency", () => {
  it.each(["missing", "amount", "allocation", "remainder"])(
    "refuses a %s change to an already posted deposit",
    async (mode) => {
      const f = fixture();
      const deposit = {
        id: "55555555-5555-4555-8555-555555555555",
        code: "OR-DEPOSIT",
        documentDate: "2026-10-14",
        amountCents: 5000,
        allocatedCents: 5000,
        remainderCents: 0,
      };
      f.initial.receipts = [deposit];
      if (mode !== "missing") {
        const changed = { ...deposit };
        if (mode === "amount") changed.amountCents++;
        if (mode === "allocation") changed.allocatedCents--;
        if (mode === "remainder") changed.remainderCents++;
        f.received.receipts.unshift(changed);
      }
      await expect(receivePaymentAndMatch(f.initial, f.lines, f)).rejects.toThrow();
      expect(f.inputs.map((i) => i.action)).toEqual(["receive_balance"]);
    },
  );
  it.each(["needs_review", "closed", "abandoned"] as const)(
    "never matches a contradictory %s result",
    async (state) => {
      const f = fixture();
      f.received.state = state;
      await expect(receivePaymentAndMatch(f.initial, f.lines, f)).rejects.toThrow();
      expect(f.inputs.map((i) => i.action)).toEqual(["receive_balance"]);
    },
  );
  it("does not reoffer collection from a contradictory saved-payment response", async () => {
    const f = fixture();
    f.received.allowedActions = ["receive_balance"];
    await expect(receivePaymentAndMatch(f.initial, f.lines, f)).rejects.toThrow();
    expect(f.inputs.map((i) => i.action)).toEqual(["receive_balance"]);
  });
  it.each(["bill", "total", "outstanding", "receipt", "review"])(
    "rejects an inconsistent final matching %s result without retry",
    async (mode) => {
      const f = fixture();
      if (mode === "bill") f.matched.bill!.id = "foreign";
      if (mode === "total") f.matched.bill!.totalCents++;
      if (mode === "outstanding") f.matched.bill!.outstandingCents = 1;
      if (mode === "receipt") f.matched.receipts = [];
      if (mode === "review") f.matched.state = "needs_review";
      await expect(receivePaymentAndMatch(f.initial, f.lines, f)).rejects.toBeInstanceOf(
        SavedPaymentMatchingError,
      );
      expect(f.inputs.map((i) => i.action)).toEqual(["receive_balance", "apply_balance"]);
    },
  );
  it("does not claim the payment was verified when receipt identity/amount is contradictory", async () => {
    const f = fixture();
    f.received.receipts[0].amountCents++;
    await expect(receivePaymentAndMatch(f.initial, f.lines, f)).rejects.toMatchObject({
      receiptVerified: false,
    });
  });
  it("retains verified receipt status when matching fails", async () => {
    const f = fixture();
    f.submit.mockImplementation(async (input) => {
      if (input.action === "apply_balance") throw new Error("lost");
      return f.received;
    });
    await expect(receivePaymentAndMatch(f.initial, f.lines, f)).rejects.toMatchObject({
      receiptVerified: true,
    });
  });
});
