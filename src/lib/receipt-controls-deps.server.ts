/* eslint-disable @typescript-eslint/no-explicit-any -- untyped service-role rows for staged (ungenerated) tables */
// Production wiring for receipt controls. GET-only N3 reads; service-role
// database access through the staged transaction functions.
import { logAudit } from "./audit.server";
import { getHotelSettingsReadOnly } from "./hotel-store.server";
import { n3Receipts } from "./n3-receipts.server";
import { parseDepositAccount } from "./deposits-store.server";
import { ReceiptControlError } from "./receipt-controls";
import {
  readReceiptControlEvidence,
  type ReceiptControlActor,
  type ScopedDeposit,
} from "./receipt-controls-evidence.server";
import { supabaseReceiptControlDb, type StoreDeps } from "./receipt-controls-store.server";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as { from: (t: string) => any };
}

export async function loadDeposit(tenantId: string, depositId: string): Promise<ScopedDeposit | null> {
  const res = await (await admin())
    .from("hotel_reservation_deposits")
    .select(
      "id, reservation_id, status, n3_receipt_id, n3_doc_code, n3_customer_id, n3_reference_no, currency_code, payment_lines",
    )
    .eq("tenant_id", tenantId)
    .eq("id", depositId)
    .maybeSingle();
  if (res.error) throw new ReceiptControlError("receipt_control_store_failed");
  if (!res.data) return null;
  const r = res.data;
  return {
    id: r.id,
    reservationId: r.reservation_id,
    status: r.status,
    n3ReceiptId: r.n3_receipt_id ?? null,
    n3DocCode: r.n3_doc_code ?? null,
    n3CustomerId: r.n3_customer_id ?? null,
    n3ReferenceNo: r.n3_reference_no,
    currencyCode: r.currency_code,
    paymentLines: Array.isArray(r.payment_lines) ? r.payment_lines : [],
  };
}

const accountCurrencyId = (body: unknown): string | null => {
  const d = (body as any)?.data ?? (body as any)?.Data;
  const v = d?.currencyId ?? d?.CurrencyId;
  return typeof v === "number" || typeof v === "string" ? String(v) : null;
};

export function defaultReceiptControlDeps(): StoreDeps {
  return {
    db: supabaseReceiptControlDb(),
    readEvidence: (actor, depositId) =>
      readReceiptControlEvidence(actor, depositId, { loadDeposit, n3: n3Receipts }),
    async resolveAccount(actor: ReceiptControlActor, accountId, originalAccountId) {
      const settings = await getHotelSettingsReadOnly(actor.tenantId);
      if (settings?.paymentAccountVisibility?.[accountId.toLowerCase()] === false) return null;
      const orig = await n3Receipts.getAccountById(actor.n3Token, originalAccountId);
      if (orig.kind === "response" && orig.status === 401)
        throw new ReceiptControlError("unauthorized");
      const currencyId = orig.kind === "response" ? accountCurrencyId(orig.body) : null;
      if (!currencyId) return null;
      const out = await n3Receipts.getAccountById(actor.n3Token, accountId);
      if (out.kind === "response" && out.status === 401)
        throw new ReceiptControlError("unauthorized");
      const acc = parseDepositAccount(out, accountId, currencyId);
      if (!acc) return null;
      return settings?.paymentAccountAliases?.[acc.id.toLowerCase()] || `${acc.code} — ${acc.name}`;
    },
    async walkInCustomerId(tenantId) {
      return (await getHotelSettingsReadOnly(tenantId))?.walkInCustomer?.n3Id ?? null;
    },
    async labels(tenantId, keys) {
      const { resolveActorLabels } = await import("./tenant-store.server");
      return resolveActorLabels(tenantId, keys);
    },
    async bookingRefs(tenantId, ids) {
      if (!ids.length) return new Map();
      const res = await (await admin())
        .from("hotel_reservations")
        .select("id, booking_reference")
        .eq("tenant_id", tenantId)
        .in("id", ids);
      if (res.error) throw new ReceiptControlError("receipt_control_store_failed");
      return new Map((res.data ?? []).map((r: any) => [r.id, r.booking_reference]));
    },
    async audit(e) {
      await logAudit(e);
    },
  };
}
