// Run 5D3.1 / 5D3.2 — server-only orchestration for departures and the
// read-only checkout folio preview.
//
// HARD SCOPE BOUNDARY (enforced by review + tests):
//   * Every N3 interaction in this module is a GET. Nothing here creates,
//     matches, updates, refunds, voids or deletes an N3 document.
//   * Nothing here mutates reservation status, room allocation status or
//     housekeeping state, and nothing here inserts a settings row.
//   * All money is computed here from server-owned rows; the browser never
//     computes a financial value.

import {
  buildSummary,
  blocker,
  classifyDepositReceipt,
  computeRoomFolio,
  dedupeBlockers,
  departureBucket,
  departuresDateRange,
  DEPOSIT_VERIFICATION_CAP,
  DEPOSIT_VERIFICATION_CONCURRENCY,
  HISTORY_BLOCKING_EVENT_TYPES,
  mapWithConcurrency,
  propertyTodayIso,
  roomDisplayLabel,
  standingBlockers,
  sumOrNull,
  validateAssignmentEvidence,
  validateCurrencyEvidence,
  type AssignmentGuestEvidence,
  type Blocker,
  type CheckoutPreviewDTO,
  type DeparturesQuery,
  type DeparturesResponseDTO,
  type DepartureListItemDTO,
  type FolioRoomInput,
  type N3ReadOutcome,
  type SafeVerifiedDepositRow,
} from "./checkout-preview";
import type { FolioTotalsDTO } from "./folio-view";
import { centsToAmount, toCents } from "./checkout-money";

// ---------------------------------------------------------------- typed client

type PgError = { message: string } | null;
type ListResult<T> = { data: T[] | null; error: PgError; count?: number | null };
type SingleResult<T> = { data: T | null; error: PgError };

interface Builder<T> extends PromiseLike<ListResult<T>> {
  select(cols: string, opts?: { count?: "exact"; head?: boolean }): Builder<T>;
  eq(col: string, value: unknown): Builder<T>;
  in(col: string, values: readonly unknown[]): Builder<T>;
  gte(col: string, value: unknown): Builder<T>;
  lte(col: string, value: unknown): Builder<T>;
  lt(col: string, value: unknown): Builder<T>;
  gt(col: string, value: unknown): Builder<T>;
  order(col: string, opts?: { ascending?: boolean }): Builder<T>;
  range(from: number, to: number): Builder<T>;
  limit(n: number): Builder<T>;
  maybeSingle(): PromiseLike<SingleResult<T>>;
}

interface ReadDb {
  from<T>(table: string): Builder<T>;
}

async function db(): Promise<ReadDb> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as ReadDb;
}

export class CheckoutPreviewError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 500) {
    super(code);
    this.code = code;
    this.status = status;
    this.name = "CheckoutPreviewError";
  }
}

function nested<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

// ---------------------------------------------------------------- departures

type DepartureRow = {
  id: string;
  booking_reference: string;
  arrival_date: string;
  departure_date: string;
  expected_check_out_at: string | null;
};

type DepartureRoomRow = {
  reservation_id: string;
  hotel_rooms:
    | { room_number: string; display_name: string | null; n3_stock_name: string | null }
    | { room_number: string; display_name: string | null; n3_stock_name: string | null }[]
    | null;
};

type DepartureGuestRow = {
  reservation_id: string;
  is_primary: boolean;
  hotel_guests:
    | { full_name: string; mobile: string | null }
    | { full_name: string; mobile: string | null }[]
    | null;
};

export async function listDepartures(input: {
  tenantId: string;
  query: DeparturesQuery;
  propertyToday: string;
}): Promise<DeparturesResponseDTO> {
  const sb = await db();
  const { tenantId, query, propertyToday } = input;
  const range = departuresDateRange(query, propertyToday);

  let q = sb
    .from<DepartureRow>("hotel_reservations")
    .select("id, booking_reference, arrival_date, departure_date, expected_check_out_at", {
      count: "exact",
    })
    .eq("tenant_id", tenantId)
    .eq("status", "checked_in");
  if (range.gte) q = q.gte("departure_date", range.gte);
  if (range.lte) q = q.lte("departure_date", range.lte);
  if (range.lt) q = q.lt("departure_date", range.lt);
  if (range.gt) q = q.gt("departure_date", range.gt);
  const res = await q
    .order("departure_date", { ascending: true })
    .order("booking_reference", { ascending: true })
    .range(query.offset, query.offset + query.limit - 1);
  if (res.error) throw new CheckoutPreviewError("checkout_preview_failed");
  const rows = res.data ?? [];

  const counts = await departureCounts(sb, tenantId, propertyToday);

  const ids = rows.map((r) => r.id);
  const roomsByRes = new Map<string, string[]>();
  const guestsByRes = new Map<string, number>();
  const primaryByRes = new Map<string, string>();
  const primaryMobileByRes = new Map<string, string | null>();
  if (ids.length > 0) {
    const rr = await sb
      .from<DepartureRoomRow>("hotel_reservation_rooms")
      .select("reservation_id, hotel_rooms(room_number, display_name, n3_stock_name)")
      .eq("tenant_id", tenantId)
      .in("reservation_id", ids)
      .eq("allocation_status", "occupied");
    if (rr.error) throw new CheckoutPreviewError("checkout_preview_failed");
    for (const row of rr.data ?? []) {
      const room = nested(row.hotel_rooms);
      const label = roomDisplayLabel({
        displayName: room?.display_name ?? null,
        n3StockName: room?.n3_stock_name ?? null,
        roomNumber: room?.room_number ?? "",
      });
      const list = roomsByRes.get(row.reservation_id) ?? [];
      list.push(label);
      roomsByRes.set(row.reservation_id, list);
    }
    const gg = await sb
      .from<DepartureGuestRow>("hotel_reservation_guests")
      .select("reservation_id, is_primary, hotel_guests(full_name, mobile)")
      .eq("tenant_id", tenantId)
      .in("reservation_id", ids);
    if (gg.error) throw new CheckoutPreviewError("checkout_preview_failed");
    for (const row of gg.data ?? []) {
      guestsByRes.set(row.reservation_id, (guestsByRes.get(row.reservation_id) ?? 0) + 1);
      if (row.is_primary) {
        const g = nested(row.hotel_guests);
        if (g?.full_name) primaryByRes.set(row.reservation_id, g.full_name);
        primaryMobileByRes.set(row.reservation_id, g?.mobile ?? null);
      }
    }
  }

  const items: DepartureListItemDTO[] = rows.map((r) => ({
    reservationId: r.id,
    bookingReference: r.booking_reference,
    primaryGuestName: primaryByRes.get(r.id) ?? null,
    primaryGuestMobile: primaryMobileByRes.get(r.id) ?? null,
    arrivalDate: r.arrival_date,
    departureDate: r.departure_date,
    expectedCheckOutAt: r.expected_check_out_at ?? null,
    roomLabels: (roomsByRes.get(r.id) ?? []).sort(),
    guestCount: guestsByRes.get(r.id) ?? 0,
    bucket: departureBucket(r.departure_date, propertyToday),
    previewAvailable: true,
  }));

  return {
    propertyDate: propertyToday,
    bucket: query.bucket,
    items,
    total: typeof res.count === "number" ? res.count : items.length,
    counts,
    limit: query.limit,
    offset: query.offset,
  };
}

async function departureCounts(sb: ReadDb, tenantId: string, propertyToday: string) {
  const head = () =>
    sb
      .from<{ id: string }>("hotel_reservations")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "checked_in");
  const [today, overdue, upcoming] = await Promise.all([
    head().eq("departure_date", propertyToday),
    head().lt("departure_date", propertyToday),
    head().gt("departure_date", propertyToday),
  ]);
  for (const r of [today, overdue, upcoming]) {
    if (r.error) throw new CheckoutPreviewError("checkout_preview_failed");
  }
  const t = today.count ?? 0;
  const o = overdue.count ?? 0;
  const u = upcoming.count ?? 0;
  return { today: t, overdue: o, upcoming: u, all: t + o + u };
}

/**
 * READ-ONLY property date. Never creates a settings row: an unconfigured
 * tenant fails closed with `hotel_settings_missing`.
 */
export async function resolvePropertyToday(tenantId: string, now = new Date()): Promise<string> {
  const { getHotelSettingsReadOnly } = await import("./hotel-store.server");
  const settings = await getHotelSettingsReadOnly(tenantId);
  if (!settings) throw new CheckoutPreviewError("hotel_settings_missing", 409);
  const today = propertyTodayIso(settings.timezone, now);
  if (!today) throw new CheckoutPreviewError("property_timezone_invalid", 409);
  return today;
}

// ---------------------------------------------------------------- preview

export type CheckoutSettingsEvidence = {
  timezone: string;
  currency: string;
  walkInCustomerId: string | null;
};

export type CheckoutReservationEvidence = {
  id: string;
  bookingReference: string;
  status: string;
  arrivalDate: string;
  departureDate: string;
  currency: string;
  expectedCheckOutAt: string | null;
  primaryGuestName: string | null;
  rooms: CheckoutRoomEvidence[];
  guests: AssignmentGuestEvidence[];
};

export type CheckoutRoomEvidence = FolioRoomInput & {
  hotelRoomId: string | null;
  maxOccupancy: number | null;
  adults: number | null;
  children: number | null;
};

export type CheckoutPreviewDeps = {
  loadReservation(
    tenantId: string,
    reservationId: string,
  ): Promise<CheckoutReservationEvidence | null>;
  /** Existence-only, tenant-scoped query for blocking applied event types. */
  hasHistoryGap(tenantId: string, reservationId: string): Promise<boolean>;
  loadDeposits(tenantId: string, reservationId: string): Promise<DepositLite[]>;
  /** SELECT-only settings read; null when the tenant has no settings row. */
  loadSettings(tenantId: string): Promise<CheckoutSettingsEvidence | null>;
  getReceiptById(token: string, receiptId: string): Promise<N3ReadOutcome>;
  /**
   * HH-GOLIVE-01A authoritative folio. Read-only: it never prepares a folio,
   * so an unprepared reservation reports `prepared: false` instead of being
   * silently priced from room nights.
   */
  loadPreparedFolio(
    tenantId: string,
    reservationId: string,
    timezone: string,
  ): Promise<PreparedFolioEvidence>;
  now?: Date;
};

export type PreparedFolioEvidence = {
  prepared: boolean;
  /** Authoritative grand total in integer cents; null when not calculable. */
  grandTotalCents: number | null;
  totals: FolioTotalsDTO | null;
  /** Folio-side reasons the prepared total is not settle-ready. */
  blockers: Blocker[];
};

export type DepositLite = {
  id: string;
  status: string;
  amount: number | string;
  currencyCode: string;
  n3ReceiptId: string | null;
  n3DocCode: string | null;
  n3ReferenceNo: string;
  n3CustomerId: string | null;
  n3CustomerCode: string | null;
  n3CustomerName: string | null;
  createdAt: string;
};

/**
 * Build the read-only checkout preview. Pure orchestration over injected
 * loaders so the whole decision tree is unit-testable without a database.
 */
export async function buildCheckoutPreview(input: {
  tenantId: string;
  reservationId: string;
  n3Token: string;
  deps: CheckoutPreviewDeps;
}): Promise<CheckoutPreviewDTO> {
  const { tenantId, reservationId, n3Token, deps } = input;
  const now = deps.now ?? new Date();

  const settings = await deps.loadSettings(tenantId);
  if (!settings) throw new CheckoutPreviewError("hotel_settings_missing", 409);
  const propertyDate = propertyTodayIso(settings.timezone, now);
  if (!propertyDate) throw new CheckoutPreviewError("property_timezone_invalid", 409);

  const reservation = await deps.loadReservation(tenantId, reservationId);
  if (!reservation) throw new CheckoutPreviewError("reservation_not_found", 404);
  if (reservation.status !== "checked_in") {
    throw new CheckoutPreviewError("reservation_not_checked_in", 409);
  }

  const currencyBlockers = validateCurrencyEvidence(settings.currency, reservation.currency);
  const assignmentBlockers = validateAssignmentEvidence({
    rooms: reservation.rooms.map((r) => ({
      reservationRoomId: r.reservationRoomId,
      hotelRoomId: r.hotelRoomId,
      maxOccupancy: r.maxOccupancy,
      adults: r.adults,
      children: r.children,
      allocationStatus: r.allocationStatus,
    })),
    guests: reservation.guests,
  });

  const historyGap = await deps.hasHistoryGap(tenantId, reservationId);

  const folio = computeRoomFolio({
    rooms: reservation.rooms,
    arrivalDate: reservation.arrivalDate,
    departureDate: reservation.departureDate,
    currency: reservation.currency,
    historyGap,
  });

  const preparedFolio = await deps.loadPreparedFolio(tenantId, reservationId, settings.timezone);

  const depositOutcome = await verifyDeposits({
    tenantId,
    reservationId,
    reservationCurrency: reservation.currency,
    walkInCustomerId: settings.walkInCustomerId,
    n3Token,
    deps,
  });

  const blockers = dedupeBlockers([
    ...currencyBlockers,
    ...assignmentBlockers,
    ...folio.blockers,
    ...preparedFolio.blockers,
    ...depositOutcome.blockers,
    ...standingBlockers(),
  ]);

  const hardBlocked = blockers.some((b) => b.severity === "blocking");
  // ONE authoritative balance: the prepared folio grand total. The room-night
  // projection below is evidence for the future N3 posting, never a total.
  const preparedTotalCents = hardBlocked ? null : preparedFolio.grandTotalCents;
  const verifiedTotalCents = hardBlocked ? null : depositOutcome.verifiedTotalCents;
  const summary = buildSummary(preparedTotalCents, verifiedTotalCents);
  const folioStatus: "calculated" | "blocked" | "not_prepared" = hardBlocked
    ? "blocked"
    : !preparedFolio.prepared
      ? "not_prepared"
      : preparedTotalCents === null
        ? "blocked"
        : "calculated";
  const calculationComplete =
    !hardBlocked && folioStatus === "calculated" && verifiedTotalCents !== null;

  return {
    generatedAt: now.toISOString(),
    propertyDate,
    reservation: {
      id: reservation.id,
      bookingReference: reservation.bookingReference,
      status: "checked_in",
      primaryGuestName: reservation.primaryGuestName,
      arrivalDate: reservation.arrivalDate,
      departureDate: reservation.departureDate,
      expectedCheckOutAt: reservation.expectedCheckOutAt,
      currency: reservation.currency,
      roomLabels: reservation.rooms.map(roomDisplayLabel).sort(),
    },
    folio: {
      scope: "authoritative",
      calculationStatus: folioStatus,
      prepared: preparedFolio.prepared,
      roomNightEvidence: hardBlocked
        ? folio.lines.map((l) => ({ ...l, lineTotal: null }))
        : folio.lines,
      totals: preparedTotalCents === null ? null : preparedFolio.totals,
      preparedTotal: preparedTotalCents === null ? null : centsToAmount(preparedTotalCents),
    },
    deposits: {
      rows: depositOutcome.rows,
      verifiedTotal: verifiedTotalCents === null ? null : centsToAmount(verifiedTotalCents),
      hasUncertainRows: depositOutcome.rows.some((r) => r.verification !== "verified"),
    },
    summary,
    readiness: {
      calculationComplete,
      financialPostingEnabled: false,
      blockers,
    },
  };
}

type Verdict = {
  row: SafeVerifiedDepositRow;
  cents: number | null;
  customerId?: string | null;
};

async function verifyDeposits(input: {
  tenantId: string;
  reservationId: string;
  reservationCurrency: string;
  walkInCustomerId: string | null;
  n3Token: string;
  deps: CheckoutPreviewDeps;
}): Promise<{
  rows: SafeVerifiedDepositRow[];
  verifiedTotalCents: number | null;
  blockers: Blocker[];
}> {
  const { deps } = input;
  const all = await deps.loadDeposits(input.tenantId, input.reservationId);
  const blockers: Blocker[] = [];
  const rows: SafeVerifiedDepositRow[] = [];

  if (all.length > DEPOSIT_VERIFICATION_CAP) {
    blockers.push(blocker("deposit_verification_cap_exceeded"));
  }
  const considered = all.slice(0, DEPOSIT_VERIFICATION_CAP);

  const verdicts = await mapWithConcurrency<DepositLite, Verdict>(
    considered,
    DEPOSIT_VERIFICATION_CONCURRENCY,
    async (d) => {
      const amountCents = toCents(d.amount);
      const base = {
        id: d.id,
        n3DocCode: d.n3DocCode,
        amount: amountCents === null ? 0 : centsToAmount(amountCents),
        currency: d.currencyCode,
        customerLabel: d.n3CustomerName ?? d.n3CustomerCode,
        createdAt: d.createdAt,
      };
      if (d.status === "submitting" || d.status === "unknown") {
        return { row: mk(base, "uncertain", "deposit_result_uncertain"), cents: null };
      }
      if (d.status === "failed") {
        return { row: mk(base, "failed", null), cents: 0 };
      }
      // Only a POSTED local row is eligible for live verification.
      if (d.status !== "posted") {
        return { row: mk(base, "not_counted", "deposit_identity_missing"), cents: null };
      }
      if (amountCents === null) {
        return { row: mk(base, "not_counted", "invalid_money_scale"), cents: null };
      }
      if (d.currencyCode.toUpperCase() !== input.reservationCurrency.toUpperCase()) {
        return { row: mk(base, "not_counted", "deposit_currency_mismatch"), cents: null };
      }
      // Minimum immutable LOCAL identity, including the customer ID.
      if (!d.n3ReceiptId || !d.n3DocCode || !d.n3ReferenceNo || !d.n3CustomerId) {
        return { row: mk(base, "not_counted", "deposit_identity_missing"), cents: null };
      }
      const outcome = await deps.getReceiptById(input.n3Token, d.n3ReceiptId);
      const verdict = classifyDepositReceipt(outcome, {
        n3ReceiptId: d.n3ReceiptId,
        n3DocCode: d.n3DocCode,
        n3ReferenceNo: d.n3ReferenceNo,
        n3CustomerId: d.n3CustomerId,
        currencyCode: d.currencyCode,
        amountCents,
      });
      if (verdict.counted) {
        // Compare the proven customer with the tenant's CURRENT Walk-in mapping.
        if (!input.walkInCustomerId) {
          return { row: mk(base, "not_counted", "walk_in_customer_not_mapped"), cents: null };
        }
        if (d.n3CustomerId !== input.walkInCustomerId) {
          return {
            row: mk(base, "not_counted", "deposit_walk_in_customer_mismatch"),
            cents: null,
          };
        }
        return {
          row: mk(base, "verified", null),
          cents: amountCents,
          customerId: d.n3CustomerId,
        };
      }
      if (verdict.unauthorized) throw new CheckoutPreviewError("unauthorized", 401);
      return { row: mk(base, "not_counted", verdict.code), cents: null };
    },
  );

  const countedCents: number[] = [];
  const customers = new Set<string>();
  let uncertain = false;
  for (const v of verdicts) {
    rows.push(v.row);
    if (v.cents === null) {
      uncertain = true;
      if (v.row.reasonCode) blockers.push(blocker(v.row.reasonCode));
    } else if (v.cents > 0) {
      countedCents.push(v.cents);
      if (v.customerId) customers.add(v.customerId);
    }
  }
  if (customers.size > 1) blockers.push(blocker("multiple_deposit_customers"));

  const verifiedTotalCents = uncertain ? null : sumOrNull(countedCents);
  return { rows, verifiedTotalCents, blockers: dedupeBlockers(blockers) };
}

function mk(
  base: Omit<SafeVerifiedDepositRow, "verification" | "reasonCode" | "reason">,
  verification: SafeVerifiedDepositRow["verification"],
  reasonCode: string | null,
): SafeVerifiedDepositRow {
  return {
    ...base,
    verification,
    reasonCode,
    reason: reasonCode ? blocker(reasonCode).message : null,
  };
}

// ---------------------------------------------------------------- real deps

type ReservationHeadRow = {
  id: string;
  booking_reference: string;
  status: string;
  arrival_date: string;
  departure_date: string;
  currency: string;
  expected_check_out_at: string | null;
};

type ReservationRoomRow = {
  id: string;
  hotel_room_id: string | null;
  agreed_rate: number | string;
  base_rate_snapshot: number | string | null;
  allocation_status: string;
  adults: number | null;
  children: number | null;
  hotel_rooms: ReservationRoomNested | ReservationRoomNested[] | null;
};

type ReservationRoomNested = {
  room_number: string;
  display_name: string | null;
  n3_stock_name: string | null;
  n3_stock_id: string | null;
  n3_stock_code: string | null;
  max_occupancy: number | null;
};

type ReservationGuestRow = {
  guest_id: string;
  is_primary: boolean;
  reservation_room_id: string | null;
  hotel_guests: { full_name: string } | { full_name: string }[] | null;
};

type DepositRow = {
  id: string;
  status: string;
  amount: number | string;
  currency_code: string;
  n3_receipt_id: string | null;
  n3_doc_code: string | null;
  n3_reference_no: string;
  n3_customer_id: string | null;
  n3_customer_code: string | null;
  n3_customer_name: string | null;
  created_at: string;
};

export const liveCheckoutDeps: CheckoutPreviewDeps = {
  async loadReservation(tenantId, reservationId) {
    const sb = await db();
    const head = await sb
      .from<ReservationHeadRow>("hotel_reservations")
      .select(
        "id, booking_reference, status, arrival_date, departure_date, currency, expected_check_out_at",
      )
      .eq("tenant_id", tenantId)
      .eq("id", reservationId)
      .maybeSingle();
    if (head.error) throw new CheckoutPreviewError("checkout_preview_failed");
    if (!head.data) return null;
    const r = head.data;

    const rooms = await sb
      .from<ReservationRoomRow>("hotel_reservation_rooms")
      .select(
        "id, hotel_room_id, agreed_rate, base_rate_snapshot, allocation_status, adults, children, hotel_rooms(room_number, display_name, n3_stock_name, n3_stock_id, n3_stock_code, max_occupancy)",
      )
      .eq("tenant_id", tenantId)
      .eq("reservation_id", reservationId);
    if (rooms.error) throw new CheckoutPreviewError("checkout_preview_failed");

    const guests = await sb
      .from<ReservationGuestRow>("hotel_reservation_guests")
      .select("guest_id, is_primary, reservation_room_id, hotel_guests(full_name)")
      .eq("tenant_id", tenantId)
      .eq("reservation_id", reservationId);
    if (guests.error) throw new CheckoutPreviewError("checkout_preview_failed");
    const guestRows = guests.data ?? [];
    const primary = guestRows.find((g) => g.is_primary);

    return {
      id: r.id,
      bookingReference: r.booking_reference,
      status: r.status,
      arrivalDate: r.arrival_date,
      departureDate: r.departure_date,
      currency: r.currency,
      expectedCheckOutAt: r.expected_check_out_at ?? null,
      primaryGuestName: nested(primary?.hotel_guests ?? null)?.full_name ?? null,
      rooms: (rooms.data ?? []).map((row) => {
        const n = nested(row.hotel_rooms);
        return {
          reservationRoomId: row.id,
          hotelRoomId: row.hotel_room_id,
          roomNumber: n?.room_number ?? "",
          displayName: n?.display_name ?? null,
          n3StockName: n?.n3_stock_name ?? null,
          n3StockId: n?.n3_stock_id ?? null,
          n3StockCode: n?.n3_stock_code ?? null,
          agreedRate: row.agreed_rate,
          baseRateSnapshot: row.base_rate_snapshot ?? null,
          allocationStatus: row.allocation_status,
          maxOccupancy: n?.max_occupancy ?? null,
          adults: row.adults,
          children: row.children,
        };
      }),
      guests: guestRows.map((g) => ({
        guestId: g.guest_id,
        isPrimary: Boolean(g.is_primary),
        reservationRoomId: g.reservation_room_id ?? null,
      })),
    };
  },

  async hasHistoryGap(tenantId, reservationId) {
    const sb = await db();
    const res = await sb
      .from<{ event_type: string }>("hotel_reservation_events")
      .select("event_type")
      .eq("tenant_id", tenantId)
      .eq("reservation_id", reservationId)
      .in("event_type", [...HISTORY_BLOCKING_EVENT_TYPES])
      .limit(1);
    if (res.error) throw new CheckoutPreviewError("checkout_preview_failed");
    return (res.data ?? []).length > 0;
  },

  async loadDeposits(tenantId, reservationId) {
    const sb = await db();
    const res = await sb
      .from<DepositRow>("hotel_reservation_deposits")
      .select(
        "id, status, amount, currency_code, n3_receipt_id, n3_doc_code, n3_reference_no, n3_customer_id, n3_customer_code, n3_customer_name, created_at",
      )
      .eq("tenant_id", tenantId)
      .eq("reservation_id", reservationId)
      .order("created_at", { ascending: true })
      .limit(100);
    if (res.error) throw new CheckoutPreviewError("checkout_preview_failed");
    return (res.data ?? []).map((r) => ({
      id: r.id,
      status: r.status,
      amount: r.amount,
      currencyCode: r.currency_code,
      n3ReceiptId: r.n3_receipt_id ?? null,
      n3DocCode: r.n3_doc_code ?? null,
      n3ReferenceNo: r.n3_reference_no,
      n3CustomerId: r.n3_customer_id ?? null,
      n3CustomerCode: r.n3_customer_code ?? null,
      n3CustomerName: r.n3_customer_name ?? null,
      createdAt: r.created_at,
    }));
  },

  async loadSettings(tenantId) {
    const { getHotelSettingsReadOnly } = await import("./hotel-store.server");
    const s = await getHotelSettingsReadOnly(tenantId);
    if (!s) return null;
    return {
      timezone: s.timezone,
      currency: s.currency,
      walkInCustomerId: s.walkInCustomer?.n3Id ?? null,
    };
  },

  async loadPreparedFolio(tenantId, reservationId, timezone) {
    const { buildFolioView } = await import("./folio-store.server");
    const dto = await buildFolioView({
      tenantId,
      reservationId,
      actorKey: "system:checkout-preview",
      timezone,
      // Read-only projection: the preview never grants a mutation capability.
      capability: {
        canAddItem: false,
        canAdjust: false,
        canSetTaxClass: false,
        canManageCharges: false,
      },
    });
    // Projected room nights keep the read-only screen/print complete, but
    // checkout readiness still requires the immutable persisted snapshots.
    const prepared = dto.readiness.roomNightsPrepared;
    const grandTotalCents = dto.readiness.calculationComplete
      ? toCents(dto.totals.grandTotal)
      : null;
    const blockers: Blocker[] = [];
    if (!prepared) blockers.push(blocker("folio_not_prepared"));
    for (const b of dto.blockers) {
      blockers.push({
        code: b.code,
        severity: b.severity === "blocking" ? "blocking" : "warning",
        message: b.message,
      });
    }
    return {
      prepared,
      grandTotalCents,
      totals: grandTotalCents === null ? null : dto.totals,
      blockers,
    };
  },

  async getReceiptById(token, receiptId) {
    const { n3Receipts, isRealN3Id } = await import("./n3-receipts.server");
    if (!isRealN3Id(receiptId)) {
      return { kind: "transport_error", reason: "network" };
    }
    const out = await n3Receipts.getById(token, receiptId);
    return out.kind === "response"
      ? { kind: "response", status: out.status, body: out.body }
      : { kind: "transport_error", reason: out.reason };
  },
};
