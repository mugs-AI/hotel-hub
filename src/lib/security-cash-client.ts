import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSessionMe, SESSION_QUERY_KEY } from "./session-client";
import { identityFromSession, receiptIdentityKey } from "./receipt-controls-client";
import { hotelJson } from "./hotel-settings-client";
import { securityMessage } from "./security-cash";
// Mounted editors are keyed by identity. Late responses must also pass this fence.
export function useSecurityIdentity() {
  const me = useSessionMe();
  const qc = useQueryClient();
  const identity = identityFromSession(me);
  const latest = useRef(identity);
  latest.current = identity;
  return {
    identity,
    me,
    qc,
    isCurrent: (expected: string) =>
      latest.current === expected &&
      receiptIdentityKey(qc.getQueryData(SESSION_QUERY_KEY)) === expected,
  };
}
export function useSecurityWriter(identity: string, isCurrent: (identity: string) => boolean) {
  const [busy, setBusy] = useState(false),
    [feedback, setFeedback] = useState("");
  const abort = useRef<AbortController | null>(null);
  const prior = useRef<{ body: string; key: string } | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  async function send<T>(url: string, payload: Record<string, unknown>): Promise<T | null> {
    if (busy || !isCurrent(identity)) return null;
    const serialized = JSON.stringify(payload);
    if (prior.current?.body !== serialized)
      prior.current = { body: serialized, key: crypto.randomUUID() };
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setFeedback("");
    try {
      const result = await hotelJson<T>(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-hotelhub-expected-identity": identity },
        body: JSON.stringify({ ...payload, key: prior.current.key }),
        signal: controller.signal,
      });
      if (controller.signal.aborted || !isCurrent(identity)) return null;
      prior.current = null;
      setFeedback("Recorded.");
      return result;
    } catch (e) {
      if (!controller.signal.aborted && isCurrent(identity))
        setFeedback(securityMessage(e instanceof Error ? e.message : ""));
      return null;
    } finally {
      if (isCurrent(identity)) setBusy(false);
    }
  }
  return { send, busy, feedback, setFeedback };
}
export function securityPrint(targetId: string) {
  const target = document.getElementById(targetId);
  if (!target) return;
  document
    .querySelectorAll("[data-security-print-active]")
    .forEach((el) => el.removeAttribute("data-security-print-active"));
  target.setAttribute("data-security-print-active", "");
  window.print();
}
