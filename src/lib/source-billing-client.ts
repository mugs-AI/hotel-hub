import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSessionMe, SESSION_QUERY_KEY } from "./session-client";
import { identityFromSession } from "./receipt-controls-client";
import { hasPermission } from "./rbac";
import { parseSourceCheckoutView, type SourceCheckoutView } from "./source-billing-checkout";
import { settlementReaderMatches } from "./settlement-view";
import { invalidateSettlementReaders, SettlementApiError } from "./settlement-client";
import type { SettlementStepInput } from "./settlement";
import type { SettlementPaymentLine } from "./settlement-payment-entry";
import { receivePaymentAndMatch } from "./settlement-payment-sequence";
import { useWorkspace, useWorkspaceDraft } from "./workspace-context";
type Recovery = { identity: string; legId: string; planDigest: string; revision: string };
type Stay = NonNullable<SourceCheckoutView["stay"]>;
type Leg = Stay["legs"][number];
export function useSourceBilling(id: string, active = true) {
  const session = useSessionMe(),
    qc = useQueryClient(),
    identity = identityFromSession(session);
  const own = session.data?.authenticated ? session.data : null,
    tenantId = own?.tenant.tenantId;
  const enabled = !!(active && identity && own && hasPermission(own.role, "hotel:checkout:write"));
  const scope = `${identity}:${id}`,
    current = useRef(scope),
    alive = useRef(true),
    busy = useRef<string | null>(null),
    keys = useRef(new Map<string, string>());
  current.current = scope;
  const [pending, setPending] = useState(false);
  const workspace = useWorkspace();
  const [savedRecovery, setRecovery] = useWorkspaceDraft<Recovery | null>(
    "source-billing-recovery",
    null,
    undefined,
    `reservation:${id.toLowerCase()}`,
  );
  const recovery = savedRecovery?.identity === identity ? savedRecovery : null;
  function sameSession() {
    return (
      !!identity &&
      identityFromSession({ data: qc.getQueryData(SESSION_QUERY_KEY) }) === identity &&
      (!workspace || workspace.isCurrent())
    );
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  function isCurrent() {
    return (
      alive.current &&
      current.current === scope &&
      !!identity &&
      identityFromSession({ data: qc.getQueryData(SESSION_QUERY_KEY) }) === identity
    );
  }
  async function request(
    tail: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<SourceCheckoutView> {
    const r = await fetch(
      `/api/hotel/reservations/${encodeURIComponent(id)}/source-billing${tail}`,
      {
        method: body ? "POST" : "GET",
        credentials: "same-origin",
        cache: "no-store",
        signal,
        headers: {
          accept: "application/json",
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
    const raw = await r.json().catch(() => null);
    if (!r.ok) {
      if (r.status === 401) void qc.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
      throw new SettlementApiError(r.status, raw?.error || "source_billing_unavailable");
    }
    const safe = parseSourceCheckoutView(raw, tenantId!, id);
    if (!safe) throw new SettlementApiError(503, "source_billing_invalid_result");
    return safe;
  }
  const q = useQuery<SourceCheckoutView, SettlementApiError>({
    queryKey: ["source-billing", identity, id],
    enabled,
    retry: false,
    staleTime: 0,
    queryFn: ({ signal }) => request("", undefined, signal),
  });
  useEffect(() => {
    const foreign = {
      queryKey: ["source-billing"],
      predicate: (q: { queryKey: readonly unknown[] }) => !identity || q.queryKey[1] !== identity,
    };
    void qc.cancelQueries(foreign);
    qc.removeQueries(foreign);
    setPending(false);
    keys.current.clear();
  }, [identity, id, qc]);
  function requestKey(key: string) {
    let value = keys.current.get(key);
    if (!value) {
      value = crypto.randomUUID();
      keys.current.set(key, value);
    }
    return value;
  }
  async function exclusive(work: () => Promise<SourceCheckoutView>) {
    if (!enabled || !isCurrent() || busy.current === scope)
      throw new SettlementApiError(409, "source_billing_scope_changed");
    busy.current = scope;
    setPending(true);
    try {
      return await work();
    } finally {
      if (busy.current === scope) busy.current = null;
      if (isCurrent()) setPending(false);
    }
  }
  async function save(tail: string, body: unknown) {
    const result = await request(tail, body);
    if (!isCurrent()) throw new SettlementApiError(409, "source_billing_scope_changed");
    qc.setQueryData(["source-billing", identity, id], result);
    // This mount does not depend on a legacy useSettlement subscriber.
    void qc.invalidateQueries({
      predicate: (query) =>
        settlementReaderMatches(query.queryKey, tenantId!, id) ||
        (["source-payer", "source-attribution"].includes(String(query.queryKey[0])) &&
          query.queryKey[1] === identity &&
          query.queryKey[2] === id),
    });
    invalidateSettlementReaders(id);
    return result;
  }
  async function financial(stay: Stay, leg: Leg, work: () => Promise<SourceCheckoutView>) {
    return exclusive(async () => {
      if (recovery) throw new SettlementApiError(409, "source_billing_recovery_required");
      const hold = () => {
        if (sameSession())
          setRecovery({
            identity: identity!,
            legId: leg.legId,
            planDigest: stay.planDigest,
            revision: leg.view.revision,
          });
      };
      try {
        const result = await work();
        if (result.stay?.legs.find((l) => l.legId === leg.legId)?.view.blockers.length) hold();
        return result;
      } catch (e) {
        hold();
        throw e;
      }
    });
  }
  const run = (tail: string, body: unknown) => exclusive(() => save(tail, body));
  function stepBody(stay: Stay, leg: Leg, action: SettlementStepInput) {
    if (
      leg.view.intentId !== leg.legId ||
      (action.intentId && action.intentId !== leg.legId) ||
      action.expectedRevision !== leg.view.revision ||
      action.action === "close" ||
      (leg.kind === "source_room" && action.action !== "post_bill") ||
      !leg.view.allowedActions.includes(action.action)
    )
      throw new SettlementApiError(409, "source_billing_action_unavailable");
    return {
      legId: leg.legId,
      planDigest: stay.planDigest,
      expectedRevision: leg.view.revision,
      action,
    };
  }
  return {
    ...q,
    identity,
    data: enabled && !q.error ? q.data : undefined,
    pending,
    recovery: !!recovery,
    confirm: (review: NonNullable<SourceCheckoutView["review"]>) =>
      run("/confirm", {
        expectedFolioRevision: review.folioRevision,
        planDigest: review.planDigest,
        clientRequestId: requestKey(`confirm:${review.planDigest}`),
      }),
    postLeg: (
      stay: NonNullable<SourceCheckoutView["stay"]>,
      leg: NonNullable<SourceCheckoutView["stay"]>["legs"][number],
    ) =>
      financial(stay, leg, () =>
        save("/step", {
          legId: leg.legId,
          planDigest: stay.planDigest,
          expectedRevision: leg.view.revision,
          action: {
            action: "post_bill",
            intentId: leg.legId,
            expectedRevision: leg.view.revision,
            snapshotDigest: leg.view.snapshotDigest,
            clientRequestId: requestKey(`bill:${stay.planDigest}:${leg.legId}`),
          },
        }),
      ),
    step: (stay: Stay, leg: Leg, action: "apply_deposits" | "apply_balance") =>
      financial(stay, leg, () =>
        save(
          "/step",
          stepBody(stay, leg, { action, intentId: leg.legId, expectedRevision: leg.view.revision }),
        ),
      ),
    receive: (stay: Stay, leg: Leg, lines: SettlementPaymentLine[]) =>
      financial(stay, leg, async () => {
        if (leg.kind !== "guest")
          throw new SettlementApiError(409, "source_billing_guest_action_required");
        let result: SourceCheckoutView | undefined;
        let currentLeg = structuredClone(leg);
        const originalDigest = stay.planDigest;
        await receivePaymentAndMatch(leg.view, lines, {
          isCurrent,
          async submit(action) {
            result = await save("/step", stepBody(stay, currentLeg, action));
            const selected = result.stay?.legs.find(
              (l) => l.legId === leg.legId && l.kind === "guest",
            );
            if (!selected || result.stay?.planDigest !== originalDigest)
              throw new SettlementApiError(409, "source_billing_scope_changed");
            currentLeg = selected;
            return selected.view;
          },
        });
        if (!result) throw new SettlementApiError(409, "source_billing_scope_changed");
        return result;
      }),
    reconcile: (digest: string) =>
      exclusive(async () => {
        const result = await save("/reconcile", { planDigest: digest });
        const selected = result.stay?.legs.find((l) => l.legId === recovery?.legId);
        if (
          recovery &&
          result.stay?.planDigest === recovery.planDigest &&
          selected &&
          !selected.view.blockers.length &&
          BigInt(selected.view.revision) > BigInt(recovery.revision) &&
          (selected.view.state === "settled" ||
            selected.view.allowedActions.some((a) =>
              ["apply_deposits", "apply_balance", "receive_balance"].includes(a),
            ))
        )
          setRecovery(null);
        return result;
      }),
  };
}
