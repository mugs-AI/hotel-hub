import type { HotelRole } from "./rbac";
export type NoShowInput = {
  reservationId: string;
  expectedUpdatedAt: string;
  clientRequestId: string;
  reason: string;
};
export type NoShowActor = { tenantId: string; n3UserKey: string; role: HotelRole | null };
export type NoShowResult = {
  reservationId: string;
  status: "no_show";
  updatedAt: string;
  releasedRoomIds: string[];
  accountingReviewRequired: boolean;
};
export class NoShowError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(v);
function date(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^\d{4}-\d\d-\d\d$/.test(v) &&
    Number.isFinite(Date.parse(v)) &&
    new Date(v).toISOString().slice(0, 10) === v
  );
}
export function validateNoShowInput(input: NoShowInput): void {
  if (
    !input ||
    Object.keys(input).some(
      (k) => !["reservationId", "expectedUpdatedAt", "clientRequestId", "reason"].includes(k),
    ) ||
    !uuid(input.reservationId) ||
    !uuid(input.clientRequestId) ||
    typeof input.reason !== "string" ||
    !input.reason.trim() ||
    input.reason.length > 500 ||
    typeof input.expectedUpdatedAt !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(input.expectedUpdatedAt) ||
    !date(input.expectedUpdatedAt.slice(0, 10)) ||
    !Number.isFinite(Date.parse(input.expectedUpdatedAt))
  )
    throw new NoShowError("invalid_request");
}
export function noShowEligible(status: string, arrival: string, propertyDate: string): boolean {
  return status === "confirmed" && date(arrival) && date(propertyDate) && arrival < propertyDate;
}
export const NO_SHOW_CODES = new Set([
  "forbidden",
  "invalid_request",
  "reservation_not_found",
  "reservation_changed",
  "no_show_ineligible",
  "no_show_occupied",
  "idempotency_conflict",
  "no_show_unavailable",
  "settlement_locked",
  "receipt_correction_pending",
]);
export function noShowFailureCode(error: unknown): string {
  return error instanceof NoShowError && NO_SHOW_CODES.has(error.code)
    ? error.code
    : "no_show_unavailable";
}
