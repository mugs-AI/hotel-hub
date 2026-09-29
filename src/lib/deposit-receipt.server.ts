// Read-only N3 confirmation for one HotelHub-owned deposit receipt.
import { getDeposit } from "./deposits-store.server";
import { verifyDepositReceipt } from "./deposit-receipt";
import { isRealN3Id, n3Receipts } from "./n3-receipts.server";

export class DepositReceiptError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}

export type PrintableDepositReceipt = {
  bookingReference: string;
  n3DocCode: string;
  amount: number;
  currency: string;
  customerLabel: string | null;
  accountLabel: string | null;
  recordedAt: string;
  verifiedAt: string;
};

export async function loadPrintableDepositReceipt(input: {
  tenantId: string;
  reservationId: string;
  depositId: string;
  n3Token: string;
}): Promise<PrintableDepositReceipt> {
  const deposit = await getDeposit(input.tenantId, input.reservationId, input.depositId);
  if (!deposit) throw new DepositReceiptError("deposit_not_found", 404);
  if (deposit.status !== "posted" || !isRealN3Id(deposit.n3ReceiptId) || !deposit.n3DocCode)
    throw new DepositReceiptError("deposit_not_confirmed", 409);

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [linked, reservation] = await Promise.all([
    supabaseAdmin
      .from("hotel_reservation_deposits")
      .select("n3_customer_id")
      .eq("tenant_id", input.tenantId)
      .eq("reservation_id", input.reservationId)
      .eq("id", input.depositId)
      .maybeSingle(),
    supabaseAdmin
      .from("hotel_reservations")
      .select("booking_reference")
      .eq("tenant_id", input.tenantId)
      .eq("id", input.reservationId)
      .maybeSingle(),
  ]);
  if (linked.error || reservation.error) throw new DepositReceiptError("receipt_read_failed", 500);
  if (!linked.data?.n3_customer_id || !reservation.data?.booking_reference)
    throw new DepositReceiptError("n3_receipt_mismatch", 409);

  const cents = Math.round(deposit.amount * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0 || Math.abs(deposit.amount * 100 - cents) > 0.001)
    throw new DepositReceiptError("n3_receipt_mismatch", 409);
  const n3 = await n3Receipts.getById(input.n3Token, deposit.n3ReceiptId);
  const verdict = verifyDepositReceipt(n3, {
    id: deposit.n3ReceiptId,
    docCode: deposit.n3DocCode,
    referenceNo: deposit.n3ReferenceNo,
    customerId: String(linked.data.n3_customer_id),
    currency: deposit.currencyCode,
    amountCents: cents,
  });
  if (!verdict.ok)
    throw new DepositReceiptError(verdict.code, verdict.code === "unauthorized" ? 401 : 502);

  return {
    bookingReference: reservation.data.booking_reference,
    n3DocCode: deposit.n3DocCode,
    amount: deposit.amount,
    currency: deposit.currencyCode,
    customerLabel: deposit.n3CustomerName ?? deposit.n3CustomerCode,
    accountLabel:
      deposit.paymentLines.length > 1
        ? deposit.paymentLines
            .map((l) => `${l.code} · ${l.name} (${deposit.currencyCode} ${l.amount.toFixed(2)})`)
            .join("; ")
        : (deposit.n3AccountName ?? deposit.paymentLines[0]?.name ?? null),
    recordedAt: deposit.createdAt,
    verifiedAt: new Date().toISOString(),
  };
}
