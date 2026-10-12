// Local identifier reservation only; never sends a custom document code to N3.
import type { SourcePolicyRpc } from "./source-billing-policy-store.server";
import type { SettlementActor } from "./settlement-context.server";
import type { EvidenceResult } from "./settlement";
import { propertyTodayIso } from "./checkout-preview";
export type DocumentSeries = "bill" | "receipt" | "refund";
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(v);
const prefixes = { bill: "SI", receipt: "OR", refund: "RF" } as const;
const unavailable = (code: string) => ({ kind: "unavailable" as const, code });
export function createDocumentSeries(rpc: SourcePolicyRpc, now: () => Date = () => new Date()) {
  return {
    async reserve(
      actor: SettlementActor,
      series: DocumentSeries,
      operationId: string,
      documentDate: string,
      timezone: string,
    ): Promise<EvidenceResult<{ hhNumber: string }>> {
      if (
        actor.role !== "owner" ||
        !uuid(actor.tenantId) ||
        !uuid(actor.reservationId) ||
        !uuid(operationId) ||
        !actor.n3UserKey?.trim() ||
        !actor.n3Token?.trim()
      )
        return { kind: "contradiction", code: "source_document_number_forbidden" };
      if (
        !Object.hasOwn(prefixes, series) ||
        !/^20\d{2}-\d{2}-\d{2}$/.test(documentDate) ||
        !Number.isFinite(Date.parse(documentDate)) ||
        new Date(documentDate).toISOString().slice(0, 10) !== documentDate ||
        !propertyTodayIso(timezone, now())
      )
        return { kind: "contradiction", code: "source_document_date_invalid" };
      try {
        const r = await rpc("hh_source_document_number_reserve", {
          p_tenant: actor.tenantId,
          p_reservation: actor.reservationId,
          p_actor: actor.n3UserKey,
          p_series: series,
          p_operation: operationId,
          p_document_date: documentDate,
        });
        if (r.error)
          return unavailable(
            ["42P01", "42883", "PGRST202", "PGRST205"].includes(r.error.code ?? "")
              ? "source_billing_setup_required"
              : "source_document_number_unavailable",
          );
        const v = r.data as Record<string, unknown> | null;
        const period = documentDate.slice(2, 4) + documentDate.slice(5, 7);
        if (
          !v ||
          v.tenantId !== actor.tenantId ||
          v.reservationId !== actor.reservationId ||
          v.operationId !== operationId ||
          v.series !== series ||
          v.documentDate !== documentDate ||
          typeof v.hhNumber !== "string" ||
          !new RegExp(`^${prefixes[series]}${period}\\d{5}$`).test(v.hhNumber) ||
          Number(v.hhNumber.slice(-5)) === 0
        )
          return unavailable("source_document_number_unverified");
        return { kind: "confirmed", value: { hhNumber: v.hhNumber } };
      } catch {
        return unavailable("source_document_number_unavailable");
      }
    },
  };
}
