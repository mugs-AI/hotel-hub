import { describe, expect, it } from "vitest";
import * as gates from "../receipt-automation-gates.server";
import { productionUpdateContract } from "../n3-receipt-update.server";
import type { ScopedDeposit } from "../receipt-controls-evidence.server";
import type { AutomationRequestRow } from "../receipt-automation-store.server";
import { RECEIPT_50 } from "./fixtures/receipt-automation";

// Bound only to the Owner-selected HH-created disposable receipt. Synthetic
// data; no database/client/HTTP access and no activation of the runtime flag.
const actor = {
  tenantId: "075e94a3-3876-4293-8ec5-3c541c028a09",
  n3TenantKey: "ca75ed66-69ac-40d9-92f1-f6b3a8780fdd",
  n3UserKey: "fixture-owner",
  n3Token: "fixture-only",
  role: "owner" as const,
};
const now = Date.parse("2026-10-11T16:23:18+08:00");
const env = {
  HOTELHUB_RECEIPT_CONTROL_DIRECT_EDIT: "false",
  HOTELHUB_RECEIPT_SCOPED_UAT_ENABLED: "true",
  HOTELHUB_RECEIPT_EXECUTION_BUDGET_MS: "30000",
  HOTELHUB_N3_DEPOSIT_WRITES_ENABLED: "true",
  HOTELHUB_N3_DEPOSIT_WRITE_TENANT_ALLOWLIST: actor.n3TenantKey,
  HOTELHUB_RECEIPT_EDIT_TENANT_ALLOWLIST: actor.n3TenantKey,
};
const deposit: ScopedDeposit = {
  id: "6d4995db-80d6-43f7-a032-1848b3e3e069",
  reservationId: "cab3c4fd-ad27-498b-8681-15b32f114abe",
  status: "posted",
  n3ReceiptId: "e0f206a5-43b6-49fb-18d1-08df276e8ec7",
  n3DocCode: "OR2610/003",
  n3CustomerId: "1382639",
  n3CustomerCode: "700-7001",
  n3ReferenceNo: "HH-6d4995db80d643f7a0321848",
  currencyCode: "MYR",
  paymentLines: [
    {
      id: "c3c22459-c2b7-4c43-8e43-8b52a9adabda",
      code: "700-0310",
      name: "Fixture bank",
      amount: 70,
    },
  ],
};
const selection = { reservationId: deposit.reservationId, deposit };
const original = {
  ...RECEIPT_50,
  receiptId: deposit.n3ReceiptId!,
  docCode: deposit.n3DocCode!,
  documentDate: "2026-10-11",
  reference: deposit.n3ReferenceNo,
  customerId: deposit.n3CustomerId!,
  customerCode: deposit.n3CustomerCode,
  amountCents: 7000,
  paymentLines: [
    {
      accountId: deposit.paymentLines[0]!.id,
      code: "700-0310",
      savedName: "Fixture bank",
      amountCents: 7000,
    },
  ],
};
const proposal = {
  kind: "correction" as const,
  amountCents: 8500,
  accountId: original.paymentLines[0]!.accountId,
  contact: original.contact,
};
const row = {
  generation: 2,
  tenantId: actor.tenantId,
  reservationId: deposit.reservationId,
  depositId: deposit.id,
  original,
  proposal: {
    kind: "correction",
    amountCents: 8500,
    accountId: original.paymentLines[0]!.accountId,
    contact: original.contact,
  },
} as AutomationRequestRow;
const contract = productionUpdateContract();

describe("receipt-scoped normal UAT gate", () => {
  it("selects only the exact trusted linked fixture without enabling the normal writer", () => {
    expect(gates.canAutoUpdate(actor, true, contract, env)).toBe(false);
    expect(gates.canCreateScopedReceiptUat(actor, true, contract, env, selection, now)).toBe(true);
    expect(gates.canExecuteScopedReceiptUat(actor, true, contract, env, row, now)).toBe(true);
  });
  it.each([
    { HOTELHUB_RECEIPT_SCOPED_UAT_ENABLED: undefined },
    { HOTELHUB_RECEIPT_SCOPED_UAT_ENABLED: "false" },
    { HOTELHUB_N3_DEPOSIT_WRITES_ENABLED: "false" },
    { HOTELHUB_N3_DEPOSIT_WRITE_TENANT_ALLOWLIST: "other" },
    { HOTELHUB_RECEIPT_EDIT_TENANT_ALLOWLIST: "other" },
    { HOTELHUB_RECEIPT_EXECUTION_BUDGET_MS: "0" },
  ])("keeps every prerequisite fail-closed %j", (patch) => {
    const e = { ...env, ...patch };
    expect(gates.canCreateScopedReceiptUat(actor, true, contract, e, selection, now)).toBe(false);
    expect(gates.canExecuteScopedReceiptUat(actor, true, contract, e, row, now)).toBe(false);
  });
  it.each([
    { id: "other" },
    { reservationId: "other" },
    { status: "unknown" },
    { n3ReceiptId: "3a0d118c-de6d-40bd-3bc2-08df269c5e9f" },
    { n3DocCode: "OR2610/001" },
    { n3ReferenceNo: null },
    { n3CustomerId: "other" },
    { n3CustomerCode: "other" },
    { currencyCode: "USD" },
    { paymentLines: [] },
  ])("refuses a wrong linked deposit binding %j", (patch) => {
    expect(
      gates.canCreateScopedReceiptUat(
        actor,
        true,
        contract,
        env,
        {
          ...selection,
          deposit: { ...deposit, ...patch },
        },
        now,
      ),
    ).toBe(false);
  });
  it("refuses wrong route booking, actor/role, missing schema/contract and expiry", () => {
    for (const a of [
      { ...actor, tenantId: "other" },
      { ...actor, n3TenantKey: "other" },
      { ...actor, role: "front_desk" as const },
    ]) {
      expect(gates.canCreateScopedReceiptUat(a, true, contract, env, selection, now)).toBe(false);
      expect(gates.canExecuteScopedReceiptUat(a, true, contract, env, row, now)).toBe(false);
    }
    expect(
      gates.canCreateScopedReceiptUat(
        actor,
        true,
        contract,
        env,
        { ...selection, reservationId: "other" },
        now,
      ),
    ).toBe(false);
    expect(gates.canCreateScopedReceiptUat(actor, false, contract, env, selection, now)).toBe(
      false,
    );
    expect(gates.canCreateScopedReceiptUat(actor, true, null, env, selection, now)).toBe(false);
    for (const time of [Date.parse("2026-10-13T20:00:00+08:00"), NaN]) {
      expect(gates.canCreateScopedReceiptUat(actor, true, contract, env, selection, time)).toBe(
        false,
      );
      expect(gates.canExecuteScopedReceiptUat(actor, true, contract, env, row, time)).toBe(false);
    }
  });
  it("permits only amount-only 70→85 or 85→70, never another document/account/contact", () => {
    expect(
      gates.canExecuteScopedReceiptUat(
        actor,
        true,
        contract,
        env,
        {
          ...row,
          original: {
            ...original,
            amountCents: 8500,
            paymentLines: original.paymentLines.map((l) => ({ ...l, amountCents: 8500 })),
          },
          proposal: { ...proposal, kind: "correction", amountCents: 7000 },
        },
        now,
      ),
    ).toBe(true);
    const badRows: AutomationRequestRow[] = [
      { ...row, generation: 1 },
      { ...row, tenantId: "other" },
      { ...row, reservationId: "other" },
      { ...row, depositId: "other" },
      { ...row, original: { ...original, receiptId: "other" } },
      { ...row, original: { ...original, reference: null } },
      { ...row, original: { ...original, documentDate: "2026-10-10" } },
      { ...row, proposal: { kind: "void" } },
      ...[6500, 7000, 9000].map((amountCents) => ({
        ...row,
        proposal: { ...proposal, kind: "correction" as const, amountCents },
      })),
      {
        ...row,
        proposal: { ...proposal, kind: "correction", accountId: "other", amountCents: 8500 },
      },
      {
        ...row,
        proposal: {
          ...proposal,
          kind: "correction",
          amountCents: 8500,
          contact: { ...original.contact, remark3: "changed" },
        },
      },
    ];
    for (const bad of badRows)
      expect(gates.canExecuteScopedReceiptUat(actor, true, contract, env, bad, now)).toBe(false);
  });
});
