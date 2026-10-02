import { it } from "vitest";
import * as oldMod from "../__old_evidence.server";
const BANK = "c3c22459-c2b7-4c43-8e43-8b52a9adabda";
const base = { docCode: "OR-T/001", referenceNo: "HH-REF-T" };
const shapes: Record<string, unknown[]> = {
  nested_both: [{ ...base, account: { id: BANK, code: "700-0310" }, debit: 50, credit: 0 },{ ...base, account: { id: "44444444-4444-4444-8444-444444444444", code: "700-7001" }, debit: 0, credit: 50 }],
  top_id_nested_code: [{ ...base, accountId: BANK, account:{code:"700-0310"}, debit: 50, credit: 0 },{ ...base, accountId:"44444444-4444-4444-8444-444444444444", account: { code: "700-7001" }, debit: 0, credit: 50 }],
  credit_no_id: [{ ...base, accountId: BANK, accountCode:"700-0310", debit: 50, credit: 0 },{ ...base, accountCode: "700-7001", debit: 0, credit: 50 }],
};
it("old parser", () => {
  for (const [k, rows] of Object.entries(shapes)) {
    const j = (oldMod as any).journalMatchesReceipt;
    // readJournal not exported in old; use full evidence via GL only
    console.log("SHAPE", k);
  }
});
