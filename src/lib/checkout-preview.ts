// Run 5D3.1 — pure, browser-safe checkout-preview contracts and logic.
//
// This module contains NO database, N3 or session access. Everything here is
// deterministic and directly unit-testable. The server orchestrator lives in
// `checkout-preview.server.ts`.
//
// Scope: READ-ONLY. Nothing in this run creates, matches, updates, refunds,
// voids or deletes an N3 document, and nothing changes reservation, room or
// housekeeping state.

import {
  centsToAmount,
  estimatedBalanceCents,
  excessDepositCents,
  multiplyCents,
  nightsBetween,
  sumCents,
  toCents,
} from "./checkout-money";

// ---------------------------------------------------------------- error codes

export const CHECKOUT_ERROR_CODES = new Set([
  "invalid_id",
  "invalid_filter",
  "unauthorized",
  "forbidden",
  "reservation_not_found",
  "reservation_not_checked_in",
  "property_timezone_invalid",
  "hotel_settings_missing",
  "reservation_currency_invalid",
  "reservation_currency_mismatch",
  "walk_in_customer_not_mapped",
  "room_allocation_missing",
  "room_allocation_not_occupied",
  "guest_assignment_required",
  "guest_assignment_invalid",
  "room_capacity_exceeded",
  "room_max_occupancy_invalid",
  "primary_guest_invalid",
  "invalid_stay_dates",
  "invalid_money_scale",
  "room_stock_mapping_missing",
  "historical_charge_evidence_incomplete",
  "additional_charges_and_tax_not_configured",
  "deposit_result_uncertain",
  "deposit_identity_missing",
  "deposit_live_evidence_incomplete",
  "deposit_customer_mismatch",
  "deposit_walk_in_customer_mismatch",
  "deposit_currency_mismatch",
  "multiple_deposit_customers",
  "deposit_verification_cap_exceeded",
  "n3_deposit_verification_unavailable",
  "checkout_preview_failed",
]);

export type BlockerSeverity = "blocking" | "warning";
export type Blocker = { code: string; severity: BlockerSeverity; message: string };

const BLOCKER_MESSAGES: Record<string, string> = {
  hotel_settings_missing:
    "Property settings have not been configured yet, so the folio cannot be proven.",
  property_timezone_invalid: "The property timezone is not configured correctly.",
  reservation_currency_invalid:
    "The reservation or property currency is not a valid three-letter code.",
  reservation_currency_mismatch:
    "The reservation currency does not match the property settings currency.",
  walk_in_customer_not_mapped:
    "No N3 Walk-in customer is currently mapped, so deposit ownership cannot be proven.",
  room_allocation_missing: "This reservation has no current room allocation to charge.",
  room_allocation_not_occupied:
    "One or more allocated rooms are not currently occupied, so the stay cannot be charged yet.",
  guest_assignment_required: "One or more guests are not assigned to a room.",
  guest_assignment_invalid:
    "A guest is assigned to a room that does not belong to this reservation.",
  room_capacity_exceeded: "A room has more guests than its maximum occupancy allows.",
  room_max_occupancy_invalid: "A room has no valid maximum occupancy configured.",
  primary_guest_invalid: "This reservation does not have exactly one primary guest.",
  invalid_stay_dates: "The stay dates are invalid, so nights cannot be calculated.",
  invalid_money_scale: "A stored rate is not a valid two-decimal amount, so the folio is blocked.",
  room_stock_mapping_missing:
    "A room is missing its N3 Stock Code mapping, so it cannot be charged.",
  historical_charge_evidence_incomplete:
    "This stay has a room or rate change in its history. HotelHub does not yet store an immutable room-night/rate-segment ledger, so the historical charge cannot be proven. Room/rate segment history must be implemented or corrected before accounting posting.",
  additional_charges_and_tax_not_configured:
    "Tax and additional-charge rules are not configured. Only room charges are included.",
  deposit_result_uncertain:
    "A deposit is still submitting or its result is unknown, so it cannot be counted.",
  deposit_identity_missing: "A posted deposit has no usable N3 receipt identity to verify.",
  deposit_live_evidence_incomplete:
    "A deposit could not be fully proven against its N3 receipt, so it is not counted.",
  deposit_customer_mismatch: "A deposit belongs to a different N3 customer than expected.",
  deposit_walk_in_customer_mismatch:
    "A verified deposit does not belong to the property's current N3 Walk-in customer mapping.",
  deposit_currency_mismatch: "A deposit currency does not match the reservation currency.",
  multiple_deposit_customers: "Verified deposits belong to more than one N3 customer.",
  deposit_verification_cap_exceeded:
    "This reservation has more deposits than can be verified in one preview.",
  n3_deposit_verification_unavailable:
    "N3 deposit verification is temporarily unavailable, so deposits are not counted.",
  posting_not_enabled: "N3 CashMemo posting is not enabled in this milestone.",
  matching_not_enabled: "Deposit matching and balance collection are not enabled.",
};

export function blocker(code: string, severity: BlockerSeverity = "blocking"): Blocker {
  return { code, severity, message: BLOCKER_MESSAGES[code] ?? code.replace(/_/g, " ") };
}

/** Milestone-constant readiness warnings that always appear in this run. */
export function standingBlockers(): Blocker[] {
  return [
    blocker("posting_not_enabled", "warning"),
    blocker("matching_not_enabled", "warning"),
    blocker("additional_charges_and_tax_not_configured", "warning"),
  ];
}

// ---------------------------------------------------------------- property date

/**
 * Property-local calendar date (`YYYY-MM-DD`) for the tenant's configured IANA
 * timezone. Returns null when the timezone is not usable — callers must fail
 * safely rather than assume `+08:00`.
 */
export function propertyTodayIso(timezone: string, now: Date = new Date()): string | null {
  if (typeof timezone !== "string" || !timezone.trim()) return null;
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const out = fmt.format(now);
    return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : null;
  } catch {
    return null;
  }
}

export type DepartureBucket = "today" | "overdue" | "upcoming";

export function departureBucket(departureDate: string, propertyToday: string): DepartureBucket {
  if (departureDate < propertyToday) return "overdue";
  if (departureDate === propertyToday) return "today";
  return "upcoming";
}

// ---------------------------------------------------------------- filters

export type DeparturesQuery = {
  bucket: "today" | "overdue" | "upcoming" | "all";
  from: string | null;
  to: string | null;
  limit: number;
  offset: number;
};

const ALLOWED_DEPARTURE_PARAMS = new Set(["bucket", "from", "to", "limit", "offset"]);
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function validIsoDate(v: string): boolean {
  if (!ISO_RE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Strict, bounded parse. Unknown or malformed fields fail with `invalid_filter`. */
export function parseDeparturesQuery(
  params: URLSearchParams,
): { ok: true; query: DeparturesQuery } | { ok: false; code: "invalid_filter" } {
  const bad = { ok: false, code: "invalid_filter" } as const;
  for (const key of params.keys()) {
    if (!ALLOWED_DEPARTURE_PARAMS.has(key)) return bad;
  }
  const bucketRaw = params.get("bucket") ?? "today";
  if (!["today", "overdue", "upcoming", "all"].includes(bucketRaw)) return bad;
  const from = params.get("from");
  const to = params.get("to");
  if (from !== null && !validIsoDate(from)) return bad;
  if (to !== null && !validIsoDate(to)) return bad;
  if (from !== null && to !== null && from > to) return bad;

  const limitRaw = params.get("limit");
  let limit = 25;
  if (limitRaw !== null) {
    if (!/^\d{1,3}$/.test(limitRaw)) return bad;
    limit = Number(limitRaw);
    if (limit < 1 || limit > 100) return bad;
  }
  const offsetRaw = params.get("offset");
  let offset = 0;
  if (offsetRaw !== null) {
    if (!/^\d{1,6}$/.test(offsetRaw)) return bad;
    offset = Number(offsetRaw);
    if (offset < 0) return bad;
  }
  return {
    ok: true,
    query: { bucket: bucketRaw as DeparturesQuery["bucket"], from, to, limit, offset },
  };
}

/**
 * Inclusive departure-date bounds implied by a bucket plus optional explicit
 * range. Applied in SQL BEFORE pagination.
 */
export function departuresDateRange(
  query: Pick<DeparturesQuery, "bucket" | "from" | "to">,
  propertyToday: string,
): { gte: string | null; lte: string | null; lt: string | null; gt: string | null } {
  let gte: string | null = query.from;
  let lte: string | null = query.to;
  let lt: string | null = null;
  let gt: string | null = null;
  if (query.bucket === "today") {
    gte = maxDate(gte, propertyToday);
    lte = minDate(lte, propertyToday);
  } else if (query.bucket === "overdue") {
    lt = propertyToday;
  } else if (query.bucket === "upcoming") {
    gt = propertyToday;
  }
  return { gte, lte, lt, gt };
}

function maxDate(a: string | null, b: string): string {
  return a === null || b > a ? b : a;
}
function minDate(a: string | null, b: string): string {
  return a === null || b < a ? b : a;
}

// ---------------------------------------------------------------- folio

/**
 * Applied reservation events that make the CURRENT allocation row insufficient
 * to prove the historical charge. HotelHub has no immutable room-night /
 * rate-segment ledger yet, so these fail closed rather than guessing.
 */
export const HISTORY_BLOCKING_EVENT_TYPES: ReadonlySet<string> = new Set([
  "room_changed",
  "rate_changed",
]);

export function hasHistoricalEvidenceGap(eventTypes: readonly string[]): boolean {
  return eventTypes.some((t) => HISTORY_BLOCKING_EVENT_TYPES.has(t));
}

// ------------------------------------------------- currency + assignment evidence

const CURRENCY_RE = /^[A-Za-z]{3}$/;

/**
 * Both the tenant settings currency and the reservation currency must be valid
 * three-letter codes and must agree. Fails closed with a visible blocker.
 */
export function validateCurrencyEvidence(
  settingsCurrency: string | null | undefined,
  reservationCurrency: string | null | undefined,
): Blocker[] {
  const s = typeof settingsCurrency === "string" ? settingsCurrency.trim() : "";
  const r = typeof reservationCurrency === "string" ? reservationCurrency.trim() : "";
  if (!CURRENCY_RE.test(s) || !CURRENCY_RE.test(r)) {
    return [blocker("reservation_currency_invalid")];
  }
  if (s.toUpperCase() !== r.toUpperCase()) return [blocker("reservation_currency_mismatch")];
  return [];
}

export type AssignmentRoomEvidence = {
  reservationRoomId: string;
  hotelRoomId: string | null;
  maxOccupancy: number | null;
  adults: number | null;
  children: number | null;
  allocationStatus: string;
};

export type AssignmentGuestEvidence = {
  guestId: string;
  isPrimary: boolean;
  reservationRoomId: string | null;
};

/**
 * Server-authoritative revalidation of stored guest-to-room assignments and
 * room capacity. Every rule fails closed — the browser never decides this.
 */
export function validateAssignmentEvidence(input: {
  rooms: readonly AssignmentRoomEvidence[];
  guests: readonly AssignmentGuestEvidence[];
}): Blocker[] {
  const out: Blocker[] = [];
  const { rooms, guests } = input;
  if (rooms.length === 0) return [blocker("room_allocation_missing")];

  const byId = new Map<string, AssignmentRoomEvidence>();
  for (const r of rooms) byId.set(r.reservationRoomId, r);

  let capacityInvalid = false;
  for (const r of rooms) {
    if (!Number.isInteger(r.maxOccupancy) || (r.maxOccupancy ?? 0) <= 0) capacityInvalid = true;
  }
  if (capacityInvalid) out.push(blocker("room_max_occupancy_invalid"));

  if (guests.length === 0) out.push(blocker("guest_assignment_required"));
  if (guests.some((g) => !g.reservationRoomId)) out.push(blocker("guest_assignment_required"));
  if (guests.some((g) => g.reservationRoomId && !byId.has(g.reservationRoomId))) {
    out.push(blocker("guest_assignment_invalid"));
  }
  if (guests.filter((g) => g.isPrimary).length !== 1) out.push(blocker("primary_guest_invalid"));

  let overCapacity = false;
  for (const r of rooms) {
    const cap = Number.isInteger(r.maxOccupancy) ? (r.maxOccupancy as number) : null;
    if (cap === null || cap <= 0) continue;
    const assigned = guests.filter((g) => g.reservationRoomId === r.reservationRoomId).length;
    if (assigned > cap) overCapacity = true;
    const adults = Number.isInteger(r.adults) ? (r.adults as number) : null;
    const children = Number.isInteger(r.children) ? (r.children as number) : 0;
    if (adults === null || adults < 0 || children < 0) {
      overCapacity = overCapacity || false;
      out.push(blocker("room_capacity_exceeded"));
      continue;
    }
    if (adults + children > cap) overCapacity = true;
  }
  if (overCapacity) out.push(blocker("room_capacity_exceeded"));

  return dedupeBlockers(out);
}

export function dedupeBlockers(list: readonly Blocker[]): Blocker[] {
  const seen = new Set<string>();
  const out: Blocker[] = [];
  for (const b of list) {
    if (seen.has(b.code)) continue;
    seen.add(b.code);
    out.push(b);
  }
  return out;
}

export type FolioRoomInput = {
  reservationRoomId: string;
  roomNumber: string;
  displayName: string | null;
  n3StockName: string | null;
  n3StockId: string | null;
  n3StockCode: string | null;
  agreedRate: number | string;
  baseRateSnapshot: number | string | null;
  allocationStatus: string;
};

export type SafeRoomChargeLine = {
  reservationRoomId: string;
  roomLabel: string;
  n3StockId: string | null;
  n3StockCode: string | null;
  description: string;
  servicePeriodStart: string;
  servicePeriodEnd: string;
  nights: number;
  unitRate: number | null;
  lineTotal: number | null;
  currency: string;
  /** Non-authoritative reference only; never the charged amount. */
  baseRateReference: number | null;
};

export type FolioResult = {
  calculationStatus: "calculated" | "blocked";
  lines: SafeRoomChargeLine[];
  roomChargeTotalCents: number | null;
  blockers: Blocker[];
};

export function roomDisplayLabel(r: {
  displayName: string | null;
  n3StockName: string | null;
  roomNumber: string;
}): string {
  return (r.displayName ?? r.n3StockName ?? r.roomNumber) || r.roomNumber;
}

/**
 * Server-authoritative room-only folio. Charges the accepted booking rate
 * (`agreed_rate`), never `base_rate_snapshot`.
 */
export function computeRoomFolio(input: {
  rooms: readonly FolioRoomInput[];
  arrivalDate: string;
  departureDate: string;
  currency: string;
  historyGap: boolean;
}): FolioResult {
  const blockers: Blocker[] = [];
  const nights = nightsBetween(input.arrivalDate, input.departureDate);
  const chargeable = input.rooms;

  if (chargeable.length === 0) blockers.push(blocker("room_allocation_missing"));
  if (chargeable.some((r) => r.allocationStatus !== "occupied")) {
    blockers.push(blocker("room_allocation_not_occupied"));
  }
  if (nights === null) blockers.push(blocker("invalid_stay_dates"));
  if (input.historyGap) blockers.push(blocker("historical_charge_evidence_incomplete"));

  const lines: SafeRoomChargeLine[] = [];
  const totals: number[] = [];
  let moneyInvalid = false;
  let mappingMissing = false;

  for (const r of chargeable) {
    const label = roomDisplayLabel(r);
    const rateCents = toCents(r.agreedRate);
    if (rateCents === null) moneyInvalid = true;
    if (!r.n3StockId || !r.n3StockCode) mappingMissing = true;
    const lineTotalCents =
      rateCents !== null && nights !== null ? multiplyCents(rateCents, nights) : null;
    if (rateCents !== null && nights !== null && lineTotalCents === null) moneyInvalid = true;
    if (lineTotalCents !== null) totals.push(lineTotalCents);
    const baseCents = r.baseRateSnapshot === null ? null : toCents(r.baseRateSnapshot);
    lines.push({
      reservationRoomId: r.reservationRoomId,
      roomLabel: label,
      n3StockId: r.n3StockId,
      n3StockCode: r.n3StockCode,
      description: `ROOM ${r.roomNumber} · ${input.arrivalDate} to ${input.departureDate}`,
      servicePeriodStart: input.arrivalDate,
      servicePeriodEnd: input.departureDate,
      nights: nights ?? 0,
      unitRate: rateCents === null ? null : centsToAmount(rateCents),
      lineTotal: lineTotalCents === null ? null : centsToAmount(lineTotalCents),
      currency: input.currency,
      baseRateReference: baseCents === null ? null : centsToAmount(baseCents),
    });
  }

  if (moneyInvalid) blockers.push(blocker("invalid_money_scale"));
  if (mappingMissing) blockers.push(blocker("room_stock_mapping_missing"));

  const summed = totals.length === chargeable.length ? sumCents(totals) : null;
  if (totals.length === chargeable.length && chargeable.length > 0 && summed === null) {
    blockers.push(blocker("invalid_money_scale"));
  }

  const hardBlocked = blockers.some((b) => b.severity === "blocking");
  if (hardBlocked || summed === null || chargeable.length === 0) {
    return {
      calculationStatus: "blocked",
      lines: hardBlocked
        ? lines.map((l) => ({ ...l, lineTotal: null }))
        : lines.map((l) => ({ ...l, lineTotal: null })),
      roomChargeTotalCents: null,
      blockers,
    };
  }
  return { calculationStatus: "calculated", lines, roomChargeTotalCents: summed, blockers };
}

// ---------------------------------------------------------------- deposits

/** Structural mirror of the server N3 read outcome (kept dependency-free). */
export type N3ReadOutcome =
  | { kind: "response"; status: number; body: unknown }
  | { kind: "transport_error"; reason: string };

export const DEPOSIT_VERIFICATION_CAP = 20;
export const DEPOSIT_VERIFICATION_CONCURRENCY = 3;

export type DepositExpectation = {
  n3ReceiptId: string;
  n3DocCode: string;
  n3ReferenceNo: string;
  /** Immutable local N3 customer ID. Required — a posted deposit without it is never verified. */
  n3CustomerId: string;

  currencyCode: string;
  amountCents: number;
};

export type DepositVerdict =
  | { counted: true; provenFields: string[] }
  | { counted: false; code: string; unauthorized?: true };

function unwrap(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const data = b.data;
  if (data && typeof data === "object") {
    const v = (data as Record<string, unknown>).value;
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    if (!Array.isArray(data)) return data as Record<string, unknown>;
  }
  const value = b.value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return b;
}

function pick(obj: Record<string, unknown> | null, keys: string[]): unknown {
  if (!obj) return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
    const alt = Object.keys(obj).find((x) => x.toLowerCase() === k.toLowerCase());
    if (alt && obj[alt] !== undefined && obj[alt] !== null && obj[alt] !== "") return obj[alt];
  }
  return undefined;
}

/**
 * Presence-aware field read. Unlike `pick`, this distinguishes "key absent"
 * from "key present but null/blank/malformed" so evidence checks can fail
 * closed instead of silently skipping a malformed value.
 */
function presentField(
  obj: Record<string, unknown>,
  keys: string[],
): { present: boolean; value: unknown } {
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) return { present: true, value: obj[k] };
    const alt = Object.keys(obj).find((x) => x.toLowerCase() === k.toLowerCase());
    if (alt !== undefined) return { present: true, value: obj[alt] };
  }
  return { present: false, value: undefined };
}

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function truthyFlag(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === "string") return ["true", "y", "yes", "1"].includes(v.trim().toLowerCase());
  if (typeof v === "number") return v === 1;
  return false;
}

/**
 * GET-only evidence check for one HotelHub-linked deposit. Fails closed: a
 * deposit is counted only when every field the response actually exposes
 * agrees with the immutable local ledger row.
 */
export function classifyDepositReceipt(
  outcome: N3ReadOutcome,
  expected: DepositExpectation,
): DepositVerdict {
  if (outcome.kind === "transport_error") {
    return { counted: false, code: "n3_deposit_verification_unavailable" };
  }
  if (outcome.status === 401) {
    return { counted: false, code: "unauthorized", unauthorized: true };
  }
  if (outcome.status < 200 || outcome.status >= 300) {
    return { counted: false, code: "n3_deposit_verification_unavailable" };
  }
  const v = unwrap(outcome.body);
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    return { counted: false, code: "deposit_live_evidence_incomplete" };
  }
  const proven: string[] = [];

  const id = str(pick(v, ["id", "Id", "receiptId"]));
  if (!id || id !== expected.n3ReceiptId) {
    return { counted: false, code: "deposit_live_evidence_incomplete" };
  }
  proven.push("receiptId");

  const docCode = str(pick(v, ["docCode", "DocCode", "docNo", "DocNo"]));
  if (!docCode || docCode !== expected.n3DocCode) {
    return { counted: false, code: "deposit_live_evidence_incomplete" };
  }
  proven.push("documentNumber");

  const docType = str(pick(v, ["docType", "DocType"]));
  if (docType !== "AROR") return { counted: false, code: "deposit_live_evidence_incomplete" };
  proven.push("docType");

  const ref = str(pick(v, ["referenceNo", "ReferenceNo"]));
  if (!ref || ref !== expected.n3ReferenceNo) {
    return { counted: false, code: "deposit_live_evidence_incomplete" };
  }
  proven.push("hotelHubReference");

  const custObj = pick(v, ["customer", "Customer"]);
  const cust =
    str(pick(v, ["customerId", "CustomerId"])) ??
    str(pick((custObj as Record<string, unknown>) ?? null, ["id", "Id"]));
  // Live customer evidence is MANDATORY: a receipt that does not expose its
  // customer can never be counted.
  if (!cust) return { counted: false, code: "deposit_live_evidence_incomplete" };
  if (cust !== expected.n3CustomerId) {
    return { counted: false, code: "deposit_customer_mismatch" };
  }
  proven.push("customerId");

  const currencyObj = pick(v, ["currency", "Currency"]);
  const currencyCode =
    str(pick(v, ["currencyCode", "CurrencyCode"])) ??
    str(pick((currencyObj as Record<string, unknown>) ?? null, ["code", "Code"]));
  // Live currency evidence is MANDATORY.
  if (!currencyCode) return { counted: false, code: "deposit_live_evidence_incomplete" };
  if (currencyCode.toUpperCase() !== expected.currencyCode.toUpperCase()) {
    return { counted: false, code: "deposit_currency_mismatch" };
  }
  proven.push("currency");

  const amount = num(
    pick(v, ["netTotalAmount", "NetTotalAmount", "totalAmount", "amount", "paymentAmount"]),
  );
  const amountCents = amount === null ? null : toCents(amount);
  if (amountCents === null) return { counted: false, code: "deposit_live_evidence_incomplete" };
  if (amountCents !== expected.amountCents) {
    return { counted: false, code: "deposit_live_evidence_incomplete" };
  }
  proven.push("amount");

  const voided =
    truthyFlag(pick(v, ["isVoid", "IsVoid", "isVoided", "voided", "isCancelled", "cancelled"])) ||
    (str(pick(v, ["status", "Status", "documentStatus"])) ?? "").toLowerCase() === "void" ||
    (str(pick(v, ["status", "Status", "documentStatus"])) ?? "").toLowerCase() === "cancelled";
  if (voided) return { counted: false, code: "deposit_live_evidence_incomplete" };

  // Affirmative "entirely unapplied" evidence is MANDATORY (fail-closed).
  // A receipt is counted only when at least one recognized evidence form is
  // present AND valid, and no present evidence form contradicts it.
  const knock = presentField(v, ["knockoff", "Knockoff", "knockOff", "knockOffs"]);
  const outstandingField = presentField(v, [
    "outstandingAmount",
    "OutstandingAmount",
    "unappliedAmount",
  ]);

  let unappliedProven = false;

  if (knock.present) {
    if (!Array.isArray(knock.value) || knock.value.length > 0) {
      return { counted: false, code: "deposit_live_evidence_incomplete" };
    }
    unappliedProven = true;
  }

  if (outstandingField.present) {
    const outstanding = num(outstandingField.value);
    const outstandingCents = outstanding === null ? null : toCents(outstanding);
    if (outstandingCents === null || outstandingCents !== expected.amountCents) {
      return { counted: false, code: "deposit_live_evidence_incomplete" };
    }
    unappliedProven = true;
  }

  if (!unappliedProven) {
    return { counted: false, code: "deposit_live_evidence_incomplete" };
  }
  proven.push("stillUnapplied");

  return { counted: true, provenFields: proven };
}

/** Bounded-concurrency mapper used for live deposit verification. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// ---------------------------------------------------------------- summary

export type SafeVerifiedDepositRow = {
  id: string;
  n3DocCode: string | null;
  amount: number;
  currency: string;
  customerLabel: string | null;
  verification: "verified" | "not_counted" | "uncertain" | "failed";
  reasonCode: string | null;
  reason: string | null;
  createdAt: string;
};

export type CheckoutSummary = {
  estimatedBalance: number | null;
  excessDeposit: number | null;
  n3Outstanding: null;
};

export function buildSummary(
  roomChargeTotalCents: number | null,
  verifiedDepositTotalCents: number | null,
): CheckoutSummary {
  if (roomChargeTotalCents === null || verifiedDepositTotalCents === null) {
    return { estimatedBalance: null, excessDeposit: null, n3Outstanding: null };
  }
  return {
    estimatedBalance: centsToAmount(
      estimatedBalanceCents(roomChargeTotalCents, verifiedDepositTotalCents),
    ),
    excessDeposit: centsToAmount(
      excessDepositCents(roomChargeTotalCents, verifiedDepositTotalCents),
    ),
    n3Outstanding: null,
  };
}

// ---------------------------------------------------------------- DTOs

export type CheckoutPreviewDTO = {
  generatedAt: string;
  propertyDate: string;
  reservation: {
    id: string;
    bookingReference: string;
    status: "checked_in";
    primaryGuestName: string | null;
    arrivalDate: string;
    departureDate: string;
    expectedCheckOutAt: string | null;
    currency: string;
    roomLabels: string[];
  };
  folio: {
    scope: "room_only";
    calculationStatus: "calculated" | "blocked";
    lines: SafeRoomChargeLine[];
    roomChargeTotal: number | null;
  };
  deposits: {
    rows: SafeVerifiedDepositRow[];
    verifiedTotal: number | null;
    hasUncertainRows: boolean;
  };
  summary: CheckoutSummary;
  readiness: {
    calculationComplete: boolean;
    financialPostingEnabled: false;
    blockers: Blocker[];
  };
};

export type DepartureListItemDTO = {
  reservationId: string;
  bookingReference: string;
  primaryGuestName: string | null;
  arrivalDate: string;
  departureDate: string;
  expectedCheckOutAt: string | null;
  roomLabels: string[];
  guestCount: number;
  bucket: DepartureBucket;
  previewAvailable: boolean;
};

export type DeparturesResponseDTO = {
  propertyDate: string;
  bucket: DeparturesQuery["bucket"];
  items: DepartureListItemDTO[];
  total: number;
  counts: { today: number; overdue: number; upcoming: number; all: number };
  limit: number;
  offset: number;
};

/** Checked sum for already-validated cent values; null on overflow. */
export function sumOrNull(values: readonly number[]): number | null {
  return sumCents(values);
}
