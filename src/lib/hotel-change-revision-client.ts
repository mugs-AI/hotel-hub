import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
    invalidateQueries: (filter: {
      queryKey: readonly unknown[];
      predicate?: (query: { queryKey: readonly unknown[] }) => boolean;
    }) => unknown;
  },
  identity: string,
) {
  const owner = identity.endsWith(":owner");
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
    void qc.invalidateQueries({
      queryKey: [prefix],
      ...(scoped
        ? {
            predicate: (q: { queryKey: readonly unknown[] }) =>
              q.queryKey[1] === identity &&
              (prefix !== "receipt-controls" || owner || q.queryKey[2] !== "queue"),
          }
        : {}),
    });
  }
}
class RevisionReadError extends Error {
  constructor(public status: number) {
    super("change_revision_unavailable");
  }
}
export function useHotelChangeRevision(): void {
  const identity = useReceiptIdentity(),
    qc = useQueryClient();
  const [visible, setVisible] = useState(
    () => typeof document !== "undefined" && document.visibilityState === "visible",
  );
  const [blocked, setBlocked] = useState<string | null>(null);
  useEffect(() => {
    const change = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  const observer = useRef(createRevisionObserver((scope) => invalidateRevisionEffects(qc, scope)));
  const query = useQuery({
    queryKey: ["hotel-change-revision", identity ?? "none"],
    queryFn: async () => {
      const response = await fetch("/api/hotel/change-revision", {
        credentials: "same-origin",
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) throw new RevisionReadError(response.status);
      const data = (await response.json()) as { available: boolean; revision: string | null };
      if (
        data.available &&
        (typeof data.revision !== "string" || !/^(0|[1-9]\d*)$/.test(data.revision))
      )
        throw new RevisionReadError(502);
      return data;
    },
    enabled: revisionPollInterval(identity, visible, true) !== false && blocked !== identity,
    refetchInterval: (q) =>
      q.state.status === "error"
        ? false
        : revisionPollInterval(identity, visible, q.state.data?.available !== false),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: false,
  });
  useEffect(() => {
    observer.current.observe(identity, query.isError ? null : (query.data?.revision ?? null));
  }, [identity, query.data?.revision, query.isError]);
  useEffect(() => {
    if (
      query.error instanceof RevisionReadError &&
      [401, 403].includes(query.error.status) &&
      identity
    ) {
      setBlocked(identity);
      purgeSensitiveReceiptData(qc, null);
      void qc.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    }
  }, [query.error, identity, qc]);
}
