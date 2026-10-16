// Server-only assembly of the existing prepared folio, linked deposits, current
// masters and own-token receipt/GL proof. No financial writer or activation gate.
import type { SettlementActor } from "./settlement-context.server";
import type { N3Outcome } from "./n3-receipts.server";
import type { EvidenceResult, SettlementSnapshot } from "./settlement";
import { n3BillingClient, billingReceiptBoundTo, type BillingReadLimit } from "./n3-billing.server";
import {
  readLocalSettlementFacts,
  type LocalFactsDb,
  type LocalFactsHeader,
} from "./settlement-local-facts.server";
import { loadPreparedSettlementSnapshot } from "./settlement-prepared-adapter.server";
import { createCurrentSettlementMasters } from "./settlement-current-masters.server";
import { proveReceiptBefore } from "./settlement-evidence.server";
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
/** Establish the date from the saved receipt's exact own-session GET, never its
 * local creation timestamp. Full detail/journal proof remains mandatory later. */
export function readLinkedReceiptDate(
  actor: SettlementActor,
  id: string,
  outcome: N3Outcome,
): EvidenceResult<string> {
  const missing = { kind: "unavailable" as const, code: "settlement_receipt_date_unavailable" };
  if (
    outcome.kind !== "response" ||
    outcome.status !== 200 ||
    !billingReceiptBoundTo(outcome, actor, id) ||
    !object(outcome.body)
  )
    return missing;
  const envelope = outcome.body;
  if (
    envelope.code !== "0000" ||
    !object(envelope.data) ||
    envelope.success === false ||
    envelope.isSuccessful === false
  )
    return missing;
  const d = envelope.data;
  if (
    typeof d.id !== "string" ||
    d.id.toLowerCase() !== id.toLowerCase() ||
    typeof d.docDate !== "string"
  )
    return missing;
  const date = d.docDate;
  if (
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date.slice(0, 10)).toISOString().slice(0, 10) !== date.slice(0, 10)
  )
    return missing;
  return { kind: "confirmed", value: date.slice(0, 10) };
}
export async function loadLivePreparedSettlementSnapshot(
  actor: SettlementActor,
  frozen?: SettlementSnapshot,
  /** Trusted saved reservation payer only; never a request/customer override. */
  savedPayerCustomerId?: number,
): Promise<EvidenceResult<SettlementSnapshot>> {
  const saved = frozen ? structuredClone(frozen) : undefined;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { buildFolioView, readFinancialSettings } = await import("./folio-store.server");
  const { destroySession } = await import("./session-context.server");
  const invalidateSession = async () => {
    await destroySession("n3_unauthorized");
  };
  const masters = createCurrentSettlementMasters(actor, { invalidateSession });
  const limit: BillingReadLimit = {
    deadlineAt: Date.now() + 30_000,
    signal: new AbortController().signal,
    budget: { remainingBytes: 2_000_000 },
  };
  let header: LocalFactsHeader | null = null;
  async function read<T extends N3Outcome>(promise: Promise<T>): Promise<T> {
    const r = await promise;
    if (r.kind === "response" && r.status === 401) {
      await invalidateSession();
      throw Error("n3_session_expired");
    }
    return r;
  }
  return loadPreparedSettlementSnapshot(
    actor,
    {
      now: () => new Date(),
      async readFacts(a) {
        const result = await readLocalSettlementFacts(a, {
          db: supabaseAdmin as unknown as LocalFactsDb,
          customerId: saved?.customerId ?? savedPayerCustomerId,
          frozenPropertyDate: saved?.billDate,
          now: () => new Date(),
          readFinancialSettings: (bound) => readFinancialSettings(bound.tenantId),
          async readView(bound, timezone) {
            // The prepared adapter validates this saved digest/scope before invoking readFacts.
            // Raw source versions and canonical current mappings are still checked below.
            if (saved?.folioProjection) return structuredClone(saved.folioProjection.folio);
            return buildFolioView({
              tenantId: bound.tenantId,
              reservationId: bound.reservationId,
              actorKey: bound.n3UserKey,
              timezone,
              capability: {
                canAddItem: false,
                canAdjust: false,
                canSetTaxClass: false,
                canManageCharges: false,
              },
            });
          },
          readHeader: (bound, customerId, currency) =>
            masters.readHeader(bound, customerId, currency),
          resolveRoomUom: masters.resolveRoomUom,
          async readReceiptDate(bound, id) {
            try {
              return readLinkedReceiptDate(
                bound,
                id,
                await read(n3BillingClient.readReceipt(bound, id, limit)),
              );
            } catch (e) {
              return {
                kind: "unavailable",
                code:
                  e instanceof Error && e.message === "n3_session_expired"
                    ? e.message
                    : "n3_receipt_read_unavailable",
              };
            }
          },
        });
        if (result.kind === "confirmed") header = result.value;
        return result;
      },
      verifyLine: (a, line) =>
        header
          ? masters.verifyLine(a, header, line)
          : Promise.resolve({ kind: "unavailable", code: "settlement_local_read_unavailable" }),
      async verifyReceipt(a, snapshot, receipt) {
        try {
          const [detail, journal] = await Promise.all([
            read(n3BillingClient.readReceipt(a, receipt.receiptId, limit)),
            read(n3BillingClient.readReceiptJournal(a, receipt.receiptId, limit)),
          ]);
          const checked = proveReceiptBefore(snapshot, receipt, detail, journal, a);
          return checked.kind === "confirmed" ? { kind: "confirmed", value: receipt } : checked;
        } catch (e) {
          return {
            kind: "unavailable",
            code:
              e instanceof Error && e.message === "n3_session_expired"
                ? e.message
                : "n3_receipt_read_unavailable",
          };
        }
      },
    },
    saved,
  );
}
