import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ status: "posted", calls: 0, linked: true, customer: "42" }));
const RECEIPT_ID = "11111111-1111-4111-8111-111111111111";
const RES = "22222222-2222-4222-8222-222222222222";
const DEP = "33333333-3333-4333-8333-333333333333";
vi.mock("@/lib/deposits-store.server", () => ({
  getDeposit: async (tenant: string, reservation: string, deposit: string) => {
    expect([tenant, reservation, deposit]).toEqual(["tenant-A", RES, DEP]);
    return {
      id: DEP,
      status: state.status,
      n3ReceiptId: RECEIPT_ID,
      n3DocCode: "OR-100",
      n3ReferenceNo: "HH-111111111111111111111111",
      amount: 250,
      currencyCode: "MYR",
      n3CustomerName: "Walk-in",
      n3CustomerCode: "700-C001",
      n3AccountName: "Cash",
      paymentLines: [],
      createdAt: "2026-09-29T15:30:00Z",
    };
  },
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({
          error: null,
          data: state.linked
            ? table === "hotel_reservations"
              ? { booking_reference: "BK100" }
              : { n3_customer_id: state.customer }
            : null,
        }),
      };
      return q;
    },
  },
}));
vi.mock("@/lib/n3-receipts.server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/n3-receipts.server")>(
    "@/lib/n3-receipts.server",
  );
  return {
    ...actual,
    n3Receipts: {
      getById: async () => {
        state.calls++;
        return {
          kind: "response",
          status: 200,
          durationMs: 1,
          body: {
            code: "0000",
            data: {
              value: {
                id: RECEIPT_ID,
                docCode: "OR-100",
                docType: "AROR",
                referenceNo: "HH-111111111111111111111111",
                customerId: 42,
                currencyCode: "MYR",
                totalAmount: 250,
                knockoff: [{ docType: "INV", appliedAmount: 100 }],
              },
            },
          },
        };
      },
    },
  };
});

const { loadPrintableDepositReceipt } = await import("../deposit-receipt.server");
const input = { tenantId: "tenant-A", reservationId: RES, depositId: DEP, n3Token: "secret" };
beforeEach(() => {
  state.status = "posted";
  state.linked = true;
  state.customer = "42";
  state.calls = 0;
});

describe("N3-backed deposit receipt loader", () => {
  it("reads one linked receipt, including when it has an allocation", async () => {
    const receipt = await loadPrintableDepositReceipt(input);
    expect(receipt).toMatchObject({ bookingReference: "BK100", n3DocCode: "OR-100", amount: 250 });
    expect(JSON.stringify(receipt)).not.toContain("secret");
    expect(state.calls).toBe(1);
  });

  it("does not contact N3 for an unconfirmed local posting", async () => {
    state.status = "unknown";
    await expect(loadPrintableDepositReceipt(input)).rejects.toMatchObject({
      code: "deposit_not_confirmed",
    });
    expect(state.calls).toBe(0);
  });

  it("does not contact N3 when the tenant-linked customer is missing", async () => {
    state.linked = false;
    await expect(loadPrintableDepositReceipt(input)).rejects.toMatchObject({
      code: "n3_receipt_mismatch",
    });
    expect(state.calls).toBe(0);
  });
});
