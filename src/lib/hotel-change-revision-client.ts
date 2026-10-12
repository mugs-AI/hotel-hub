import type { DepositNoticePacket } from "./deposit-notifications";
import {
  depositNoticeObserver,
  announceDepositEvents,
  dismissForeignDepositNotices,
  announceDepositRefreshFailure,
} from "./deposit-notifications-client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { SESSION_QUERY_KEY } from "./session-client";
import {
  RECEIPT_EFFECT_QUERY_PREFIXES,
  useReceiptIdentity,
  purgeSensitiveReceiptData,
} from "./receipt-controls-client";
export function revisionPollInterval(
  identity: string | null,
  visible: boolean,
  installed: boolean,
): 2000 | false {
  return visible &&
    installed &&
    !!identity &&
    (identity.endsWith(":owner") || identity.endsWith(":front_desk"))
    ? 2000
    : false;
}
export function createRevisionObserver(onChange: (identity: string) => void) {
  let previous: { identity: string; revision: string } | null = null;
  return {
    observe(identity: string | null, revision: string | null): boolean {
      if (!identity) {
        previous = null;
        return false;
      }
      if (revision === null || !/^(0|[1-9]\d*)$/.test(revision)) return false;
      const changed =
        previous !== null && previous.identity === identity && previous.revision !== revision;
      previous = { identity, revision };
      if (changed) onChange(identity);
      return changed;
    },
  };
}
export function invalidateRevisionEffects(
  qc: {
    cancelQueries?: (filter: {
      queryKey: readonly unknown[];
      predicate?: (query: { queryKey: readonly unknown[] }) => boolean;
    }) => Promise<unknown>;
    invalidateQueries: (
      filter: {
        queryKey: readonly unknown[];
        predicate?: (query: { queryKey: readonly unknown[] }) => boolean;
      },
      options?: { throwOnError: boolean; cancelRefetch: boolean },
    ) => unknown;
  },
  identity: string,
) {
  const owner = identity.endsWith(":owner");
  const refreshes: unknown[] = [];
  for (const prefix of [
    ...RECEIPT_EFFECT_QUERY_PREFIXES,
    "folio-bill-to",
    "hotel-change-policy",
    "bill-to-changes",
  ]) {
    if (!owner && ["financial-reporting", "bill-to-changes"].includes(prefix)) continue;
    const scoped = [
      "receipt-controls",
      "financial-reporting",
      "folio-bill-to",
      "hotel-change-policy",
      "bill-to-changes",
    ].includes(prefix);
    const filter = {
      queryKey: [prefix],
      ...(scoped
        ? {
            predicate: (q: { queryKey: readonly unknown[] }) =>
              q.queryKey[1] === identity &&
              (prefix !== "receipt-controls" || owner || q.queryKey[2] !== "queue"),
          }
        : {}),
    };
    refreshes.push(
      (async () => {
        // Even an initial read without cached data must not satisfy a post-commit refresh.
        if (qc.cancelQueries) await qc.cancelQueries(filter);
        return qc.invalidateQueries(filter, { throwOnError: true, cancelRefetch: true });
      })(),
    );
  }
  return Promise.all(refreshes);
}
const readerRefreshes = new WeakMap<object, { key: string; promise: Promise<unknown> }>();
function refreshReaders(qc: QueryClient, identity: string, revision: string) {
  const key = `${identity}:${revision}`;
  const current = readerRefreshes.get(qc);
  if (current?.key === key) return current.promise;
  const promise = invalidateRevisionEffects(qc, identity);
  readerRefreshes.set(qc, { key, promise });
  return promise;
}
function hideFailedReaders(qc: QueryClient) {
  for (const prefix of RECEIPT_EFFECT_QUERY_PREFIXES)
    for (const query of qc.getQueryCache().findAll({ queryKey: [prefix] }))
      if (query.state.status === "error") query.setState({ data: undefined });
}
class RevisionReadError extends Error {
  constructor(public status: number) {
    super("change_revision_unavailable");
  }
}
export function useHotelChangeRevision(): void {
  const identity = useReceiptIdentity(),
    qc = useQueryClient();
  const notices = depositNoticeObserver(qc);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  useEffect(() => {
    notices.observe(identity, null);
    dismissForeignDepositNotices(identity);
  }, [identity, notices]);
  const [visible, setVisible] = useState(
    () => typeof document !== "undefined" && document.visibilityState === "visible",
  );
  const [blocked, setBlocked] = useState<string | null>(null);
  useEffect(() => {
    const change = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  const observer = useRef(createRevisionObserver(() => {}));
  const query = useQuery({
    queryKey: ["hotel-change-revision", identity ?? "none"],
    queryFn: async () => {
      const after = notices.cursor(identity);
      const url =
        after === null
          ? "/api/hotel/change-revision"
          : `/api/hotel/change-revision?after=${encodeURIComponent(after)}`;
      const response = await fetch(url, {
        credentials: "same-origin",
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) throw new RevisionReadError(response.status);
      const data = (await response.json()) as {
        available: boolean;
        revision: string | null;
        notification?: DepositNoticePacket | null;
      };
      if (
        data.available &&
        (typeof data.revision !== "string" || !/^(0|[1-9]\d*)$/.test(data.revision))
      )
        throw new RevisionReadError(502);
      return { ...data, identity };
    },
    enabled: revisionPollInterval(identity, visible, true) !== false && blocked !== identity,
    refetchInterval: (q) =>
      q.state.status === "error" &&
      !!q.state.error &&
      "status" in q.state.error &&
      [401, 403].includes(Number(q.state.error.status))
        ? false
        : revisionPollInterval(identity, visible, q.state.data?.available !== false),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: false,
  });
  useEffect(() => {
    const changed = observer.current.observe(
      identity,
      query.isError ? null : (query.data?.revision ?? null),
    );
    if (!identity) {
      notices.observe(null, null);
      return;
    }
    if (query.isError || query.data?.identity !== identity || !query.data.available) return;
    const events = notices.observe(
      identity,
      query.data.notification ??
        (query.data.revision ? { cursor: query.data.revision, events: [] } : null),
    );
    if (!changed && !events.length) return;
    void refreshReaders(qc, identity, query.data.revision!)
      .then(() => {
        if (currentIdentity.current === identity) announceDepositEvents(identity, events);
      })
      .catch(() => {
        if (currentIdentity.current !== identity) return;
        hideFailedReaders(qc);
        announceDepositRefreshFailure(identity, events);
      });
  }, [identity, query.data, query.isError, notices, qc]);
  useEffect(() => {
    if (
      query.error instanceof RevisionReadError &&
      [401, 403].includes(query.error.status) &&
      identity
    ) {
      notices.observe(null, null);
      dismissForeignDepositNotices(null);
      setBlocked(identity);
      purgeSensitiveReceiptData(qc, null);
      void qc.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    }
  }, [query.error, identity, qc, notices]);
}
