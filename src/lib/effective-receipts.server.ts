/* eslint-disable @typescript-eslint/no-explicit-any -- untyped service-role rows for staged (ungenerated) tables */
// Server-only loader for the shared effective-receipt overlay. Before the
// staged receipt-controls migration is applied the tables do not exist and
// the overlay is empty, so every figure stays exactly as today.
import {
  applyEffectiveReceipts,
  computeReceiptOverlay,
  type ReceiptOverlay,
  type ReceiptVersionRow,
} from "./effective-receipts";

const UNRESOLVED = ["applying", "failed", "needs_review"];
const MISSING = new Set(["42P01", "PGRST205", "PGRST202"]);

type Reader = {
  versions(tenantId: string, depositIds: string[]): Promise<ReceiptVersionRow[] | null>;
  unresolved(tenantId: string, depositIds: string[]): Promise<string[] | null>;
};

/**
 * Reader over a caller-supplied client (the same injected store DB in unit
 * tests); defaults to the server service-role client in production.
 */
export function receiptReader(client?: { from: (t: string) => any }): Reader {
  const sb = async () => {
    if (client) return client;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return supabaseAdmin as unknown as { from: (t: string) => any };
  };
  return {
    async versions(tenantId, ids) {
      const res = await (await sb())
        .from("hotel_receipt_versions")
        .select(
          "deposit_id, request_id, version_no, state, receipt_id, doc_code, document_date, currency, amount_cents, payment_lines, replacement_of, verified_at, verified_contact",
        )
        .eq("tenant_id", tenantId)
        .in("deposit_id", ids);
      if (res.error) {
        if (MISSING.has(res.error.code)) return null;
        throw new Error("effective_receipts_unavailable");
      }
      return (res.data ?? []).map((r: any) => ({
        depositId: r.deposit_id,
        requestId: r.request_id,
        versionNo: r.version_no,
        state: r.state,
        receiptId: r.receipt_id,
        docCode: r.doc_code,
        documentDate: r.document_date,
        currency: r.currency,
        amountCents: Number(r.amount_cents),
        paymentLines: r.payment_lines ?? [],
        replacementOf: r.replacement_of ?? null,
        verifiedAt: r.verified_at,
        verifiedContact: r.verified_contact ?? null,
      }));
    },
    async unresolved(tenantId, ids) {
      const res = await (await sb())
        .from("hotel_receipt_control_requests")
        .select("deposit_id")
        .eq("tenant_id", tenantId)
        .in("deposit_id", ids)
        .in("state", UNRESOLVED);
      if (res.error) {
        if (MISSING.has(res.error.code)) return null;
        throw new Error("effective_receipts_unavailable");
      }
      return (res.data ?? []).map((r: any) => r.deposit_id as string);
    },
  };
}

/** Fail closed on real read errors; empty only when the feature is not installed. */
export async function loadReceiptOverlay(
  tenantId: string,
  depositIds: readonly string[],
  reader: Reader = receiptReader(),
): Promise<Map<string, ReceiptOverlay>> {
  const ids = Array.from(new Set(depositIds));
  if (!ids.length) return new Map();
  const [versions, unresolved] = await Promise.all([
    reader.versions(tenantId, ids),
    reader.unresolved(tenantId, ids),
  ]);
  return computeReceiptOverlay(versions ?? [], new Set(unresolved ?? []));
}

export async function withEffectiveReceipts<
  T extends {
    id: string;
    amount: number | string;
    n3ReceiptId: string | null;
    n3DocCode: string | null;
  },
>(tenantId: string, rows: readonly T[], reader?: Reader) {
  const overlay = await loadReceiptOverlay(
    tenantId,
    rows.map((r) => r.id),
    reader,
  );
  return applyEffectiveReceipts(rows, overlay);
}
