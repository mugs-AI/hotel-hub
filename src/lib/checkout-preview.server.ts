// Run 5D3.1 — server-only orchestration for departures and the read-only
// checkout folio preview.
//
// HARD SCOPE BOUNDARY (enforced by review + tests):
//   * Every N3 interaction in this module is a GET. Nothing here creates,
//     matches, updates, refunds, voids or deletes an N3 document.
//   * Nothing here mutates reservation status, room allocation status or
//     housekeeping state.
//   * All money is computed here from server-owned rows; the browser never
//     computes a financial value.

import {
  buildSummary,
  blocker,
  classifyDepositReceipt,
  computeRoomFolio,
  departureBucket,
  departuresDateRange,
  DEPOSIT_VERIFICATION_CAP,
  DEPOSIT_VERIFICATION_CONCURRENCY,
  hasHistoricalEvidenceGap,
  mapWithConcurrency,
  propertyTodayIso,
  roomDisplayLabel,
  standingBlockers,
  sumOrNull,
  type Blocker,
  type CheckoutPreviewDTO,
  type DeparturesQuery,
  type DeparturesResponseDTO,
  type DepartureListItemDTO,
  type FolioRoomInput,
  type N3ReadOutcome,
  type SafeVerifiedDepositRow,
} from "./checkout-preview";
import { centsToAmount, toCents } from "./checkout-money";

/* eslint-disable @typescript-eslint/no-explicit-any */
async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
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

// ---------------------------------------------------------------- departures

type DepartureRow = {
  id: string;
  booking_reference: string;
  arrival_date: string;
  departure_date: string;
  expected_check_out_at: string | null;
};

export async function listDepartures(input: {
  tenantId: string;
  query: DeparturesQuery;
  propertyToday: string;
}): Promise<DeparturesResponseDTO> {
  const sb = await admin();
  const { tenantId, query, propertyToday } = input;
  const range = departuresDateRange(query, propertyToday);

  const base = () =>
    sb
      .from("hotel_reservations")
      .select("id, booking_reference, arrival_date, departure_date, expected_check_out_at", {
        count: "exact",
      })
      .eq("tenant_id", tenantId)
      .eq("status", "checked_in");

  let q = base();
  if (range.gte) q = q.gte("departure_date", range.gte);
  if (range.lte) q = q.lte("departure_date", range.lte);
  if (range.lt) q = q.lt("departure_date", range.lt);
  if (range.gt) q = q.gt("departure_date", range.gt);
  const res = await q
    .order("departure_date", { ascending: true })
    .order("booking_reference", { ascending: true })
    .range(query.offset, query.offset + query.limit - 1);
  if (res.error) throw new CheckoutPreviewError("checkout_preview_failed");
  const rows = (res.data ?? []) as DepartureRow[];

  const counts = await departureCounts(sb, tenantId, propertyToday);

  const ids = rows.map((r) => r.id);
  const roomsByRes = new Map<string, string[]>();
  const guestsByRes = new Map<string, number>();
  const primaryByRes = new Map<string, string>();
  if (ids.length > 0) {
    const rr = await sb
      .from("hotel_reservation_rooms")
      .select("reservation_id, hotel_rooms(room_number, display_name, n3_stock_name)")
      .eq("tenant_id", tenantId)
      .in("reservation_id", ids)
      .eq("allocation_status", "occupied");
    if (rr.error) throw new CheckoutPreviewError("checkout_preview_failed");
    for (const row of (rr.data ?? []) as any[]) {
      const nested = Array.isArray(row.hotel_rooms) ? row.hotel_rooms[0] : row.hotel_rooms;
      const label = roomDisplayLabel({
        displayName: nested?.display_name ?? null,
        n3StockName: nested?.n3_stock_name ?? null,
        roomNumber: nested?.room_number ?? "",
      });
      const list = roomsByRes.get(row.reservation_id) ?? [];
      list.push(label);
      roomsByRes.set(row.reservation_id, list);
    }
    const gg = await sb
      .from("hotel_reservation_guests")
      .select("reservation_id, is_primary, hotel_guests(full_name)")
      .eq("tenant_id", tenantId)
      .in("reservation_id", ids);
    if (gg.error) throw new CheckoutPreviewError("checkout_preview_failed");
    for (const row of (gg.data ?? []) as any[]) {
      guestsByRes.set(row.reservation_id, (guestsByRes.get(row.reservation_id) ?? 0) + 1);
      if (row.is_primary) {
        const nested = Array.isArray(row.hotel_guests) ? row.hotel_guests[0] : row.hotel_guests;
        if (nested?.full_name) primaryByRes.set(row.reservation_id, nested.full_name);
      }
    }
  }

  const items: DepartureListItemDTO[] = rows.map((r) => ({
    reservationId: r.id,
    bookingReference: r.booking_reference,
    primaryGuestName: primaryByRes.get(r.id) ?? null,
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

async function departureCounts(sb: any, tenantId: string, propertyToday: string) {
  const head = () =>
    sb
      .from("hotel_reservations")
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

export async function resolvePropertyToday(tenantId: string, now = new Date()): Promise<string> {
  const { getOrCreateHotelSettings } = await import("./hotel-store.server");
  const settings = await getOrCreateHotelSettings(tenantId);
  const today = propertyTodayIso(settings.timezone, now);
  if (!today) throw new CheckoutPreviewError("property_timezone_invalid", 409);
  return today;
}

// ---------------------------------------------------------------- preview

export type CheckoutPreviewDeps = {
  loadReservation(
    tenantId: string,
    reservationId: string,
  ): Promise<{
    id: string;
    bookingReference: string;
    status: string;
    arrivalDate: string;
    departureDate: string;
    currency: string;
    expectedCheckOutAt: string | null;
    primaryGuestName: string | null;
    rooms: FolioRoomInput[];
  } | null>;
  loadEventTypes(tenantId: string, reservationId: string): Promise<string[]>;
  loadDeposits(tenantId: string, reservationId: string): Promise<DepositLite[]>;
  loadSettings(tenantId: string): Promise<{ timezone: string; currency: string }>;
  getReceiptById(token: string, receiptId: string): Promise<N3ReadOutcome>;
  now?: Date;
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
  const propertyDate = propertyTodayIso(settings.timezone, now);
  if (!propertyDate) throw new CheckoutPreviewError("property_timezone_invalid", 409);

  const reservation = await deps.loadReservation(tenantId, reservationId);
  if (!reservation) throw new CheckoutPreviewError("reservation_not_found", 404);
  if (reservation.status !== "checked_in") {
    throw new CheckoutPreviewError("reservation_not_checked_in", 409);
  }

  const eventTypes = await deps.loadEventTypes(tenantId, reservationId);
  const historyGap = hasHistoricalEvidenceGap(eventTypes);

  const folio = computeRoomFolio({
    rooms: reservation.rooms,
    arrivalDate: reservation.arrivalDate,
    departureDate: reservation.departureDate,
    currency: reservation.currency,
    historyGap,
  });

  const depositOutcome = await verifyDeposits({
    tenantId,
    reservationId,
    reservationCurrency: reservation.currency,
    n3Token,
    deps,
  });

  const blockers: Blocker[] = [
    ...folio.blockers,
    ...depositOutcome.blockers,
    ...standingBlockers(),
  ];

  const summary = buildSummary(folio.roomChargeTotalCents, depositOutcome.verifiedTotalCents);
  const calculationComplete =
    folio.calculationStatus === "calculated" &&
    depositOutcome.verifiedTotalCents !== null &&
    !blockers.some((b) => b.severity === "blocking");

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
      scope: "room_only",
      calculationStatus: folio.calculationStatus,
      lines: folio.lines,
      roomChargeTotal:
        folio.roomChargeTotalCents === null ? null : centsToAmount(folio.roomChargeTotalCents),
    },
    deposits: {
      rows: depositOutcome.rows,
      verifiedTotal:
        depositOutcome.verifiedTotalCents === null
          ? null
          : centsToAmount(depositOutcome.verifiedTotalCents),
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

async function verifyDeposits(input: {
  tenantId: string;
  reservationId: string;
  reservationCurrency: string;
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

  const verdicts = await mapWithConcurrency(
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
      if (amountCents === null) {
        return { row: mk(base, "not_counted", "invalid_money_scale"), cents: null };
      }
      if (d.currencyCode.toUpperCase() !== input.reservationCurrency.toUpperCase()) {
        return { row: mk(base, "not_counted", "deposit_currency_mismatch"), cents: null };
      }
      if (!d.n3ReceiptId || !d.n3DocCode) {
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
      const c = (v as { customerId?: string | null }).customerId;
      if (c) customers.add(c);
    }
  }
  if (customers.size > 1) blockers.push(blocker("multiple_deposit_customers"));

  const verifiedTotalCents = uncertain ? null : sumOrNull(countedCents);
  return { rows, verifiedTotalCents, blockers: dedupe(blockers) };
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

function dedupe(list: Blocker[]): Blocker[] {
  const seen = new Set<string>();
  const out: Blocker[] = [];
  for (const b of list) {
    if (seen.has(b.code)) continue;
    seen.add(b.code);
    out.push(b);
  }
  return out;
}

// ---------------------------------------------------------------- real deps

export const liveCheckoutDeps: CheckoutPreviewDeps = {
  async loadReservation(tenantId, reservationId) {
    const sb = await admin();
    const head = await sb
      .from("hotel_reservations")
      .select(
        "id, booking_reference, status, arrival_date, departure_date, currency, expected_check_out_at",
      )
      .eq("tenant_id", tenantId)
      .eq("id", reservationId)
      .maybeSingle();
    if (head.error) throw new CheckoutPreviewError("checkout_preview_failed");
    if (!head.data) return null;
    const r = head.data as any;
    const rooms = await sb
      .from("hotel_reservation_rooms")
      .select(
        "id, agreed_rate, base_rate_snapshot, allocation_status, hotel_rooms(room_number, display_name, n3_stock_name, n3_stock_id, n3_stock_code)",
      )
      .eq("tenant_id", tenantId)
      .eq("reservation_id", reservationId);
    if (rooms.error) throw new CheckoutPreviewError("checkout_preview_failed");
    const guests = await sb
      .from("hotel_reservation_guests")
      .select("is_primary, hotel_guests(full_name)")
      .eq("tenant_id", tenantId)
      .eq("reservation_id", reservationId)
      .eq("is_primary", true)
      .limit(1);
    if (guests.error) throw new CheckoutPreviewError("checkout_preview_failed");
    const g = (guests.data ?? [])[0] as any;
    const gn = g ? (Array.isArray(g.hotel_guests) ? g.hotel_guests[0] : g.hotel_guests) : null;
    return {
      id: r.id,
      bookingReference: r.booking_reference,
      status: r.status,
      arrivalDate: r.arrival_date,
      departureDate: r.departure_date,
      currency: r.currency,
      expectedCheckOutAt: r.expected_check_out_at ?? null,
      primaryGuestName: gn?.full_name ?? null,
      rooms: ((rooms.data ?? []) as any[]).map((row) => {
        const n = Array.isArray(row.hotel_rooms) ? row.hotel_rooms[0] : row.hotel_rooms;
        return {
          reservationRoomId: row.id,
          roomNumber: n?.room_number ?? "",
          displayName: n?.display_name ?? null,
          n3StockName: n?.n3_stock_name ?? null,
          n3StockId: n?.n3_stock_id ?? null,
          n3StockCode: n?.n3_stock_code ?? null,
          agreedRate: row.agreed_rate,
          baseRateSnapshot: row.base_rate_snapshot ?? null,
          allocationStatus: row.allocation_status,
        };
      }),
    };
  },

  async loadEventTypes(tenantId, reservationId) {
    const sb = await admin();
    const res = await sb
      .from("hotel_reservation_events")
      .select("event_type")
      .eq("tenant_id", tenantId)
      .eq("reservation_id", reservationId)
      .limit(500);
    if (res.error) throw new CheckoutPreviewError("checkout_preview_failed");
    return ((res.data ?? []) as any[]).map((r) => String(r.event_type));
  },

  async loadDeposits(tenantId, reservationId) {
    const sb = await admin();
    const res = await sb
      .from("hotel_reservation_deposits")
      .select(
        "id, status, amount, currency_code, n3_receipt_id, n3_doc_code, n3_reference_no, n3_customer_id, n3_customer_code, n3_customer_name, created_at",
      )
      .eq("tenant_id", tenantId)
      .eq("reservation_id", reservationId)
      .order("created_at", { ascending: true })
      .limit(100);
    if (res.error) throw new CheckoutPreviewError("checkout_preview_failed");
    return ((res.data ?? []) as any[]).map((r) => ({
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
    const { getOrCreateHotelSettings } = await import("./hotel-store.server");
    const s = await getOrCreateHotelSettings(tenantId);
    return { timezone: s.timezone, currency: s.currency };
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
