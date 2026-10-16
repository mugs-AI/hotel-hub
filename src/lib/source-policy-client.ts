import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSessionMe, SESSION_QUERY_KEY } from "./session-client";
import { identityFromSession } from "./receipt-controls-client";
import {
  parsePayerView,
  parsePolicyView,
  type ReservationPayerView,
  type SourcePolicyView,
} from "./source-policy-view";
import type { CollectionMode, SourceBillingPolicy } from "./source-billing";
import {
  parseAttributionView,
  type AttributionView,
  type AttributionSave,
} from "./charge-attribution";
import {
  parseInitialPolicyView,
  type InitialBookingPayer,
  type InitialPolicyView,
} from "./initial-booking-payer";

export function useInitialBookingPayer(sourceCode: string) {
  const session = useSessionMe(),
    qc = useQueryClient(),
    identity = identityFromSession(session);
  const tenantId = identity && session.data?.authenticated ? session.data.tenant.tenantId : null;
  const role = session.data?.authenticated ? session.data.role : null;
  const scope = JSON.stringify([identity, sourceCode]);
  const current = useRef(scope),
    alive = useRef(true);
  current.current = scope;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const enabled =
    !!identity &&
    ["owner", "front_desk"].includes(role ?? "") &&
    /^[a-z][a-z0-9_]{0,47}$/.test(sourceCode);
  const q = useQuery<InitialPolicyView, SourcePolicyApiError>({
    queryKey: ["source-policy", identity, "entry", sourceCode],
    enabled,
    retry: false,
    staleTime: 0,
    queryFn: async ({ signal }) => {
      const r = await fetch(
        `/api/hotel/booking-sources/${encodeURIComponent(sourceCode)}/initial-payer`,
        { method: "GET", credentials: "same-origin", cache: "no-store", signal },
      );
      const raw = await r.json().catch(() => null);
      if (!r.ok) {
        if (r.status === 401) void qc.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
        throw new SourcePolicyApiError(
          r.status,
          typeof raw?.error === "string" ? raw.error : "source_billing_setup_required",
        );
      }
      try {
        return parseInitialPolicyView(raw, tenantId!, sourceCode);
      } catch {
        throw new SourcePolicyApiError(503, "source_policy_scope_mismatch");
      }
    },
  });
  const data = enabled && !q.error ? q.data : undefined;
  const reviewKey = JSON.stringify([scope, data?.required ? data.policy : null]);
  const [choice, setChoice] = useState<{
    key: string;
    mode: CollectionMode;
    confirmed: boolean;
  } | null>(null);
  useEffect(() => {
    setChoice(null);
  }, [scope]);
  const own = choice?.key === reviewKey;
  const collectionMode = own
    ? choice.mode
    : data?.required
      ? data.policy.defaultCollectionMode
      : "guest";
  const confirmed = !!(own && choice.confirmed);
  const ready =
    !!data &&
    !q.isFetching &&
    (!data.required || (confirmed && data.policy.allowedCollectionModes.includes(collectionMode)));
  const selection: InitialBookingPayer | null =
    ready && data?.required
      ? { sourceId: data.policy.sourceId, policyVersion: data.policy.version, collectionMode }
      : null;
  function currentScope() {
    return (
      alive.current &&
      current.current === scope &&
      !!identity &&
      identityFromSession({ data: qc.getQueryData(SESSION_QUERY_KEY) }) === identity
    );
  }
  return {
    ...q,
    data,
    identity,
    ready,
    selection,
    collectionMode,
    confirmed,
    currentScope,
    choose: (mode: CollectionMode) => {
      if (data?.required && data.policy.allowedCollectionModes.includes(mode))
        setChoice({ key: reviewKey, mode, confirmed: false });
    },
    confirm: (yes: boolean) => {
      if (data?.required && currentScope())
        setChoice({ key: reviewKey, mode: collectionMode, confirmed: yes });
    },
    clear: () => setChoice(null),
  };
}
export class SourcePolicyApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
export function sourcePolicyMessage(code: string) {
  if (/revision_conflict|version_conflict/.test(code))
    return "This booking or policy changed. Refresh and review before saving again.";
  if (/frozen|settlement_locked/.test(code))
    return "Billing is frozen. The payer can no longer be changed.";
  if (/forbidden|owner_required/.test(code)) return "Only the Owner can change billing collection.";
  if (/unauthenticated|unauthorized|session_expired|scope_changed/.test(code))
    return "Your session changed. Reopen this booking from your current session.";
  if (code === "source_billing_policy_missing")
    return "Set up billing for this booking source in Settings.";
  return "Billing setup could not be verified. Refer Admin.";
}
function useResource<T, P>(kind: "policy" | "payer" | "attribution", id: string, active = true) {
  const session = useSessionMe(),
    qc = useQueryClient(),
    identity = identityFromSession(session);
  const tenantId = identity && session.data?.authenticated ? session.data.tenant.tenantId : null;
  const role = session.data?.authenticated ? session.data.role : null;
  const scope = JSON.stringify([identity, id, kind]),
    current = useRef(scope),
    alive = useRef(true);
  current.current = scope;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const prefix =
      kind === "policy"
        ? "source-policy"
        : kind === "payer"
          ? "source-payer"
          : "source-attribution",
    key = [prefix, identity, id] as const;
  const enabled = Boolean(
    active &&
    identity &&
    id &&
    (kind === "policy" ? role === "owner" : ["owner", "front_desk"].includes(role ?? "")),
  );
  const path =
    kind === "policy"
      ? `/api/hotel/booking-sources/${encodeURIComponent(id)}/billing-policy`
      : `/api/hotel/reservations/${encodeURIComponent(id)}/${kind === "payer" ? "payer" : "charge-attribution"}`;
  function currentScope() {
    return (
      alive.current &&
      current.current === scope &&
      identity !== null &&
      identityFromSession({ data: qc.getQueryData(SESSION_QUERY_KEY) }) === identity
    );
  }
  async function request(payload?: P, signal?: AbortSignal): Promise<T> {
    const r = await fetch(path, {
      method: payload === undefined ? "GET" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal,
      headers: {
        accept: "application/json",
        ...(payload === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const raw = await r.json().catch(() => null);
    if (!r.ok) {
      if (r.status === 401) void qc.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
      throw new SourcePolicyApiError(
        r.status,
        typeof raw?.error === "string" ? raw.error : "source_billing_unavailable",
      );
    }
    const result = tenantId
      ? kind === "policy"
        ? parsePolicyView(raw, tenantId, id)
        : kind === "payer"
          ? parsePayerView(raw, tenantId, id)
          : parseAttributionView(raw, tenantId, id)
      : null;
    if (!result) throw new SourcePolicyApiError(503, "source_billing_invalid_result");
    return result as T;
  }
  const query = useQuery<T, SourcePolicyApiError>({
    queryKey: key,
    enabled,
    retry: false,
    staleTime: 0,
    queryFn: ({ signal }) => request(undefined, signal),
  });
  const mutation = useMutation<T, SourcePolicyApiError, { scope: string; payload: P }>({
    mutationKey: [prefix, identity, id, "save"],
    retry: false,
    mutationFn: async (v) => {
      if (v.scope !== scope || !currentScope() || role !== "owner")
        throw new SourcePolicyApiError(403, "source_policy_scope_changed");
      try {
        const result = await request(v.payload);
        if (!currentScope()) throw new SourcePolicyApiError(409, "source_policy_scope_changed");
        qc.setQueryData(key, result);
        for (const p of kind !== "policy"
          ? [
              "reservations",
              "folio",
              "checkout-preview",
              "settlement",
              "source-billing",
              ...(kind === "payer" ? ["source-attribution"] : []),
            ]
          : ["source-payer"])
          void qc.invalidateQueries({ queryKey: p === "source-payer" ? [p, identity] : [p] });
        if (kind === "policy")
          void qc.invalidateQueries({ queryKey: ["source-policy", identity, "entry"] });
        return result;
      } catch (e) {
        if (currentScope()) void qc.invalidateQueries({ queryKey: key });
        throw e;
      }
    },
  });
  useEffect(() => {
    const f = {
      queryKey: [prefix],
      predicate: (q: { queryKey: readonly unknown[] }) => !identity || q.queryKey[1] !== identity,
    };
    void qc.cancelQueries(f);
    qc.removeQueries(f);
  }, [identity, prefix, qc]);
  const own = mutation.variables?.scope === scope;
  return {
    ...query,
    data: enabled && !query.error ? query.data : undefined,
    identity,
    owner: role === "owner",
    save: (payload: P) => mutation.mutateAsync({ scope, payload }),
    saving: own && mutation.isPending,
    saveError: own ? mutation.error : null,
  };
}
export function useChargeAttribution(id: string, active: boolean) {
  return useResource<AttributionView, AttributionSave>("attribution", id, active);
}
export function useSourceBillingPolicy(id: string) {
  return useResource<SourcePolicyView, { expectedVersion: string; policy: SourceBillingPolicy }>(
    "policy",
    id,
  );
}
export function useReservationPayer(id: string) {
  return useResource<
    ReservationPayerView,
    {
      expectedRevision: string;
      collectionMode: CollectionMode;
      expectedSourceId: string;
      expectedPolicyVersion: string;
      expectedReservationUpdatedAt: string;
    }
  >("payer", id);
}
