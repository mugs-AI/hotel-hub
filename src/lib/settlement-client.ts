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
