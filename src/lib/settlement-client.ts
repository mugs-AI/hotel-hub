import { isN3Guid } from "./n3-guid";
import { MAX_MONEY_CENTS } from "./checkout-money";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useSessionMe, SESSION_QUERY_KEY } from "./session-client";
import { hasPermission } from "./rbac";
import { identityFromSession } from "./receipt-controls-client";
import {
  settlementPollInterval,
  settlementReaderMatches,
  settlementRevisionChanged,
} from "./settlement-view";
import type { SettlementStepInput, SettlementView } from "./settlement";
import type { PaymentAccountChoice } from "./deposits-client";

/** Scope payment choices to the current N3 session; never reuse another tenant's list. */
export function useSettlementPaymentAccounts(id: string, enabled: boolean) {
  const session = useSessionMe(),
    qc = useQueryClient();
  const identity = identityFromSession(session);
  const query = useQuery<{ accounts: PaymentAccountChoice[] }, SettlementApiError>({
    queryKey: ["settlement-payment-accounts", identity, id],
    enabled: enabled && Boolean(identity),
    retry: false,
    staleTime: 0,
    queryFn: async ({ signal }) => {
      const r = await fetch("/api/hotel/payment-accounts", {
        credentials: "same-origin",
        cache: "no-store",
        signal,
      });
      const body = await r.json().catch(() => null);
      if (!r.ok)
        throw new SettlementApiError(
          r.status,
          body?.error || "settlement_payment_accounts_unavailable",
        );
      if (!Array.isArray(body?.accounts))
        throw new SettlementApiError(503, "settlement_payment_accounts_unavailable");
      return body;
    },
  });
  useEffect(() => {
    const foreign = {
      queryKey: ["settlement-payment-accounts"],
      predicate: (q: { queryKey: readonly unknown[] }) => !identity || q.queryKey[1] !== identity,
    };
    void qc.cancelQueries(foreign);
    qc.removeQueries(foreign);
    if (query.error instanceof SettlementApiError && query.error.status === 401)
      void qc.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
  }, [identity, query.error, qc]);
  return { ...query, data: identity && !query.error ? query.data : undefined };
}
export class SettlementApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
async function request(
  id: string,
  tail: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<SettlementView> {
  const r = await fetch(`/api/hotel/reservations/${encodeURIComponent(id)}/settlement${tail}`, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal,
    headers: {
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const value = await r.json().catch(() => null);
  if (!r.ok) throw new SettlementApiError(r.status, value?.error || "settlement_unavailable");
  return value;
}
export async function fetchSavedDocumentSelection(
  id: string,
  signal?: AbortSignal,
): Promise<import("./saved-documents-check").SavedDocumentSelection> {
  const r = await fetch(`/api/hotel/reservations/${encodeURIComponent(id)}/saved-documents-check`, {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  const value = await r.json().catch(() => null);
  if (!r.ok) throw new SettlementApiError(r.status, value?.error || "saved_check_unavailable");
  if (
    value?.reservationId !== id ||
    typeof value?.tenantId !== "string" ||
    (value?.intentId !== null && typeof value?.intentId !== "string") ||
    typeof value?.currency !== "string"
  )
    throw new SettlementApiError(503, "saved_check_scope_mismatch");
  return value;
}
export async function checkSavedDocumentsClient(
  id: string,
  intentId: string,
  signal?: AbortSignal,
): Promise<import("./saved-documents-check").SavedDocumentCheck> {
  const r = await fetch(`/api/hotel/reservations/${encodeURIComponent(id)}/saved-documents-check`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    signal,
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ intentId }),
  });
  const value = await r.json().catch(() => null);
  if (!r.ok) throw new SettlementApiError(r.status, value?.error || "saved_check_unavailable");
  if (
    value?.reservationId !== id ||
    value?.intentId !== intentId ||
    !["confirmed", "waiting", "needs_review"].includes(value?.status)
  )
    throw new SettlementApiError(503, "saved_check_scope_mismatch");
  return value;
}
/** Reads matching for saved identities only; it never dispatches an N3 write. */
export async function checkExternalMatchingClient(
  id: string,
  intentId: string,
  signal?: AbortSignal,
  source?: import("./saved-documents-check").SourceMatchingBinding,
): Promise<import("./saved-documents-check").ExternalMatchingCheckView> {
  const r = await fetch(
    `/api/hotel/reservations/${encodeURIComponent(id)}/external-matching-check`,
    {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal,
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ intentId, ...(source ? { source } : {}) }),
    },
  );
  const value = await r.json().catch(() => null);
  if (!r.ok)
    throw new SettlementApiError(r.status, value?.error || "external_matching_unavailable");
  const cents = (n: unknown) =>
    Number.isSafeInteger(n) && Number(n) >= 0 && Number(n) <= MAX_MONEY_CENTS;
  const text = (s: unknown, max = 100) => typeof s === "string" && s.length > 0 && s.length <= max;
  const matching = value?.externalMatching;
  if (
    value?.reservationId !== id ||
    value?.intentId !== intentId ||
    !text(value?.tenantId) ||
    !["confirmed", "waiting", "needs_review"].includes(value?.status) ||
    !text(value?.code) ||
    typeof value?.checkedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T/.test(value.checkedAt) ||
    !Number.isFinite(Date.parse(value.checkedAt)) ||
    !Array.isArray(value?.documents) ||
    value.documents.length > 12 ||
    value.documents.some(
      (d: Record<string, unknown> | null) =>
        !d || !isN3Guid(d.id) || !text(d.code, 80) || !["bill", "receipt"].includes(String(d.kind)),
    ) ||
    (value.status === "confirmed" &&
      (value.billOutstandingCents !== 0 ||
        !matching ||
        matching.provenance !== "external_n3_matching" ||
        matching.canClose !== false ||
        !Array.isArray(matching.matches) ||
        matching.matches.length > 11 ||
        matching.matches.some(
          (m: Record<string, unknown> | null) =>
            !m ||
            !isN3Guid(m.receiptId) ||
            !isN3Guid(m.billId) ||
            !cents(m.amountCents) ||
            m.amountCents === 0,
        ) ||
        !Array.isArray(matching.receiptObservations) ||
        matching.receiptObservations.length > 11 ||
        matching.receiptObservations.some(
          (o: Record<string, unknown> | null) =>
            !o || !isN3Guid(o.receiptId) || !cents(o.refundCents) || !cents(o.remainderCents),
        )))
  )
    throw new SettlementApiError(503, "saved_check_scope_mismatch");
  return {
    tenantId: value.tenantId,
    reservationId: id,
    intentId,
    status: value.status,
    code: value.code,
    checkedAt: value.checkedAt,
    billOutstandingCents: value.status === "confirmed" ? 0 : null,
    documents: value.documents.map((d: { id: string; code: string; kind: "bill" | "receipt" }) => ({
      id: d.id,
      code: d.code,
      kind: d.kind,
    })),
    ...(value.status === "confirmed"
      ? {
          externalMatching: {
            provenance: "external_n3_matching" as const,
            canClose: false as const,
            matches: matching.matches.map(
              (m: { receiptId: string; billId: string; amountCents: number }) => ({
                receiptId: m.receiptId,
                billId: m.billId,
                amountCents: m.amountCents,
              }),
            ),
            receiptObservations: matching.receiptObservations.map(
              (o: { receiptId: string; refundCents: number; remainderCents: number }) => ({
                receiptId: o.receiptId,
                refundCents: o.refundCents,
                remainderCents: o.remainderCents,
              }),
            ),
          },
        }
      : {}),
  };
}
export const fetchSettlement = (id: string, signal?: AbortSignal) =>
  request(id, "", undefined, signal);
export const submitSettlementStep = (id: string, input: SettlementStepInput) =>
  request(id, "/step", input);
export const reconcileSettlementClient = (id: string, intentId: string) =>
  request(id, "/reconcile", { intentId });
const readerRefreshers = new Set<{ id: string; refresh(): void }>();
export function invalidateSettlementReaders(reservationId: string): void {
  for (const r of readerRefreshers) if (r.id === reservationId) r.refresh();
}
export function useSettlement(id: string) {
  const session = useSessionMe(),
    qc = useQueryClient();
  const identity = identityFromSession(session);
  const current =
    identity && session.data && session.data.authenticated === true ? session.data : null;
  const enabled = Boolean(current && hasPermission(current.role, "hotel:checkout:view"));
  const started = useRef<number | null>(null);
  const previous = useRef<{ scope: string; revision: string } | null>(null);
  const tenantId = current?.tenant.tenantId ?? null;
  const userKey = current?.user.n3UserKey ?? null;
  useEffect(() => {
    if (!enabled || !tenantId) return;
    const r = {
      id,
      refresh: () => {
        void qc.invalidateQueries({
          predicate: (q) => settlementReaderMatches(q.queryKey, tenantId, id),
        });
      },
    };
    readerRefreshers.add(r);
    return () => {
      readerRefreshers.delete(r);
    };
  }, [enabled, tenantId, id, qc]);
  const query = useQuery({
    queryKey: ["settlement", identity, id],
    enabled,
    queryFn: ({ signal }) => fetchSettlement(id, signal),
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: (q) => {
      const state = q.state.data?.state || null;
      if (
        !["bill_dispatched", "balance_dispatched", "allocating", "closing"].includes(state || "")
      ) {
        started.current = null;
        return false;
      }
      if (started.current === null) started.current = Date.now();
      return settlementPollInterval(state, started.current, Date.now());
    },
  });
  useEffect(() => {
    const foreign = {
      queryKey: ["settlement"],
      predicate: (q: { queryKey: readonly unknown[] }) => !enabled || q.queryKey[1] !== identity,
    };
    void qc.cancelQueries(foreign);
    qc.removeQueries(foreign);
    started.current = null;
    previous.current = null;
  }, [enabled, identity, id, qc]);
  useEffect(() => {
    if (query.error instanceof SettlementApiError && query.error.status === 401) {
      qc.removeQueries({ queryKey: ["settlement"] });
      void qc.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    }
  }, [enabled, query.error, qc]);
  useEffect(() => {
    if (!enabled || query.error || !query.data || !tenantId || !userKey) {
      previous.current = null;
      return;
    }
    const scope = `${identity}:${id}`;
    if (query.data.tenantId !== tenantId || query.data.reservationId !== id) return;
    if (
      previous.current?.scope === scope &&
      settlementRevisionChanged(previous.current.revision, query.data.revision)
    )
      invalidateSettlementReaders(id);
    previous.current = { scope, revision: query.data.revision };
  }, [enabled, query.error, query.data, tenantId, userKey, identity, id]);
  const scopedData =
    query.data?.tenantId === tenantId && query.data.reservationId === id ? query.data : undefined;
  return { ...query, data: enabled && !query.error ? scopedData : undefined };
}
