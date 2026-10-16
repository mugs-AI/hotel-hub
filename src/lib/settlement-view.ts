import type { SettlementState, SettlementView } from "./settlement";
export function settlementRevisionChanged(
  previous: string | null,
  revision: string | undefined,
): boolean {
  return (
    previous !== null &&
    revision !== undefined &&
    /^(0|[1-9]\d*)$/.test(revision) &&
    revision !== previous
  );
}
/** Current scoped readers only; legacy reservation keys remain reservation-bound. */
export function settlementReaderMatches(
  key: readonly unknown[],
  tenantId: string,
  reservationId: string,
): boolean {
  const prefix = key[0];
  if (["financial-reporting", "receipt-controls"].includes(String(prefix)))
    return typeof key[1] === "string" && key[1].startsWith(tenantId + ":");
  if (prefix === "reservations")
    return key[2] === tenantId && (key[1] !== "detail" || key[3] === reservationId);
  if (["departures", "reservation-calendar", "reservations-calendar"].includes(String(prefix)))
    return key[1] === tenantId;
  if (prefix === "housekeeping") return key[1] === "board" && key[2] === tenantId;
  if (["deposits", "folio"].includes(String(prefix)))
    return (key[1] === tenantId || key[1] === "tenant") && key[2] === reservationId;
  if (prefix === "reservation-timeline")
    return key.length === 2
      ? key[1] === reservationId
      : key[1] === tenantId && key[2] === reservationId;
  return (
    ["checkout-preview", "reservation", "reservation-operations"].includes(String(prefix)) &&
    key[1] === reservationId
  );
}
export function settlementPresentation(v: SettlementView, owner: boolean) {
  const review = v.state === "needs_review" || v.blockers.length > 0;
  return {
    showMoney: !v.blockers.length && Boolean(v.bill),
    canReconcile: owner && Boolean(v.intentId) && v.state !== "closed",
    message: review
      ? "Settlement needs review. Check N3 result to recover the saved attempt."
      : v.state === "closed"
        ? "Checkout completed. Rooms handed to housekeeping."
        : v.state === "settled"
          ? "Accounting is settled. Complete checkout when ready."
          : v.state === "awaiting_payment"
            ? "Confirm the balance payment and selected account before proceeding."
            : v.allowedActions.includes("apply_balance")
              ? "The balance payment is already recorded. Apply the received payment to the bill."
              : "Each action verifies the current accounting result before continuing.",
  };
}
export function settlementPollInterval(
  state: SettlementState | null,
  started: number,
  now: number,
): 5000 | false {
  return ["bill_dispatched", "balance_dispatched", "allocating", "closing"].includes(state || "") &&
    now - started >= 0 &&
    now - started < 60000
    ? 5000
    : false;
}
