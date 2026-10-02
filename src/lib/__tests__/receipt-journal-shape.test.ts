// Regression for the live "journal_unproven" refusal on a receipt whose GL
// already passed the deposit posting verifier. The documented GLTransactionDto
// carries a nested `account` object; rows that name their account only there
// (and an AR credit without a top-level accountId) are the same posting.
import { describe, expect, it } from "vitest";
import {
  journalMismatchReasons,
  readJournal,
} from "../receipt-controls-evidence.server";
import type { N3Outcome } from "../n3-receipts.server";

const BANK = "c3c22459-c2b7-4c43-8e43-8b52a9adabda";
const receipt = {
  amountCents: 5000,
  docCode: "OR-T/001",
  reference: "HH-REF-T",
  customerCode: "700-7001",
};
const lines = [{ accountId: BANK, amountCents: 5000 }];
const ok = (data: unknown): N3Outcome => ({
  kind: "response",
  status: 200,
  body: { type: "API", success: true, code: "0000", message: "ok", data, error: null },
  durationMs: 1,
});
const base = { docCode: "OR-T/001", referenceNo: "HH-REF-T", isCancelled: false };
const nestedRows = [
  { ...base, account: { id: BANK, code: "700-0310" }, debit: 50, credit: 0 },
  { ...base, account: { code: "700-7001" }, customerId: "x", debit: 0, credit: 50 },
];

describe("receipt journal shape (documented nested account)", () => {
  it("accepts rows whose account is only in the nested GLTransactionDto.account", () => {
    const j = readJournal(ok(nestedRows));
    expect(journalMismatchReasons(j, receipt, lines)).toEqual([]);
  });

  it("fails closed when top-level and nested account ids conflict", () => {
    const rows = [
      { ...nestedRows[0], accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      nestedRows[1],
    ];
    expect(journalMismatchReasons(readJournal(ok(rows)), receipt, lines)).toContain(
      "journal_account_id_conflict",
    );
  });

  it("still rejects a wrong customer, a balanced-but-wrong bank and missing references", () => {
    const wrongCust = [nestedRows[0], { ...nestedRows[1], account: { code: "700-9999" } }];
    expect(journalMismatchReasons(readJournal(ok(wrongCust)), receipt, lines)).toEqual([
      "journal_credit_customer_mismatch",
    ]);
    const otherBank = [
      { ...nestedRows[0], account: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", code: "X" } },
      nestedRows[1],
    ];
    expect(journalMismatchReasons(readJournal(ok(otherBank)), receipt, lines)).toEqual([
      "journal_debit_account_mismatch",
    ]);
    const noRef = nestedRows.map(({ referenceNo: _r, ...r }) => r);
    expect(journalMismatchReasons(readJournal(ok(noRef)), receipt, lines)).toEqual([
      "journal_row_reference_missing",
    ]);
  });

  it("reports safe reason codes for an unreadable reply (no values)", () => {
    expect(readJournal(ok("not json")).reasons).toEqual(["journal_envelope_unreadable"]);
    expect(readJournal(ok([])).reasons).toEqual(["journal_rows_empty"]);
    const reasons = readJournal(ok([{ ...base, debit: 0, credit: 0 }])).reasons;
    expect(reasons.every((r) => /^journal_[a-z_]+$/.test(r))).toBe(true);
  });
});
