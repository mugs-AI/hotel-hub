import { describe, expect, it, vi } from "vitest";
// The list read model must use only the injected DB; the live client is banned.
vi.mock("@/integrations/supabase/client.server", () => {
  throw new Error("unit test must not use the live database");
});
import * as store from "../folio-store.server";
type Row = Record<string, unknown>;
function fixture() {
  const tables: Record<string, Row[]> = {
    hotel_reservations: [
      {
        id: "r1",
        tenant_id: "t1",
        booking_reference: "BK260920001",
        arrival_date: "2026-09-20",
        departure_date: "2026-09-25",
        currency: "MYR",
      },
    ],
    hotel_reservation_rooms: [
      {
        id: "rr1",
        tenant_id: "t1",
        reservation_id: "r1",
        hotel_room_id: "room1",
        arrival_date: "2026-09-20",
        departure_date: "2026-09-25",
        agreed_rate: 188,
      },
    ],
    hotel_rooms: [{ id: "room1", tenant_id: "t1", room_number: "101", n3_stock_id: "stock1" }],
    hotel_folios: [
      { id: "f1", tenant_id: "t1", reservation_id: "r1", currency: "MYR", status: "draft" },
    ],
    hotel_financial_settings: [
      {
        tenant_id: "t1",
        service_tax_registered: true,
        service_tax_accommodation_rate_bp: 800,
        n3_tax_code_accommodation_id: "tax1",
        n3_tax_code_accommodation_snapshot: "SV-8",
        rounding_mode: "nearest_5_cents",
        n3_rounding_account_id: "round1",
      },
    ],
    hotel_folio_lines: [9500, -300].map((amount, i) => ({
      id: `l${i}`,
      tenant_id: "t1",
      folio_id: "f1",
      line_type: i === 0 ? "add_on" : "discount",
      status: "draft",
      tax_class: "accommodation",
      description_snapshot: "Charge",
      quantity: 1,
      unit_price_cents: amount,
      subtotal_cents: amount,
      source_reservation_room_id: null,
      source_hotel_room_id: null,
      stay_date: null,
      catalogue_id: null,
      reason: null,
      reverses_line_id: null,
      actor_n3_user_key: "staff",
      client_request_id: null,
      created_at: "2026-10-01T00:00:00Z",
    })),
    hotel_reservation_deposits: [
      {
        id: "d1",
        tenant_id: "t1",
        reservation_id: "r1",
        status: "posted",
        amount: 50,
        currency_code: "MYR",
      },
      {
        id: "d2",
        tenant_id: "t1",
        reservation_id: "r1",
        status: "unknown",
        amount: 100,
        currency_code: "MYR",
      },
      {
        id: "d3",
        tenant_id: "t2",
        reservation_id: "r1",
        status: "posted",
        amount: 999,
        currency_code: "MYR",
      },
    ],
  };
  const calls: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  const db = {
    from(table: string) {
      const call = { table, filters: [] as Array<[string, unknown]> };
      calls.push(call);
      let rows = [...(tables[table] ?? [])];
      const q = {
        select: () => q,
        eq: (key: string, value: unknown) => {
          call.filters.push([key, value]);
          rows = rows.filter((r) => r[key] === value);
          return q;
        },
        in: (key: string, values: unknown[]) => {
          call.filters.push([key, values]);
          rows = rows.filter((r) => values.includes(r[key]));
          return q;
        },
        order: () => q,
        range: (from: number, to: number) => {
          rows = rows.slice(from, to + 1);
          return q;
        },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve: (r: unknown) => unknown) =>
          Promise.resolve({ data: rows, error: null }).then(resolve),
      };
      return q;
    },
  };
  return { db: db as unknown as store.FolioDb, tables, calls };
}
describe("reservation list financial read model", () => {
  it.each([10000000.01, "188.001", "invalid"])(
    "does not omit room charges and show a partial total for unsafe rate %s",
    async (rate) => {
      const f = fixture();
      f.tables.hotel_reservation_rooms[0].agreed_rate = rate;
      const rows = await store.buildReservationListAmounts(
        { tenantId: "t1", reservationIds: ["r1"], timezone: "Asia/Kuala_Lumpur" },
        f.db,
      );
      expect(rows[0]).toMatchObject({ totalAmount: null, depositAmount: 50 });
    },
  );
  it("reads later database pages so a posted deposit is not silently omitted", async () => {
    const f = fixture();
    f.tables.hotel_reservation_deposits = Array.from({ length: 500 }, (_, i) => ({
      id: `failed${i}`,
      tenant_id: "t1",
      reservation_id: "r1",
      status: "failed",
      amount: 25,
      currency_code: "MYR",
    }));
    f.tables.hotel_reservation_deposits.push({
      id: "posted-last",
      tenant_id: "t1",
      reservation_id: "r1",
      status: "posted",
      amount: 50,
      currency_code: "MYR",
    });
    const rows = await store.buildReservationListAmounts(
      { tenantId: "t1", reservationIds: ["r1"], timezone: "Asia/Kuala_Lumpur" },
      f.db,
    );
    expect(rows[0]).toMatchObject({
      totalAmount: 1114.55,
      depositAmount: 50,
      hasUnconfirmedDeposit: false,
    });
    expect(f.calls.filter((c) => c.table === "hotel_reservation_deposits")).toHaveLength(2);
  });
  it("shows an unavailable total when a required tax mapping is missing", async () => {
    const f = fixture();
    f.tables.hotel_financial_settings[0].n3_tax_code_accommodation_id = null;
    const rows = await store.buildReservationListAmounts(
      { tenantId: "t1", reservationIds: ["r1"], timezone: "Asia/Kuala_Lumpur" },
      f.db,
    );
    expect(rows[0]).toMatchObject({ totalAmount: null, depositAmount: 50 });
  });
  it("matches the prepared folio including projected nights, extras, discount, tax and rounding, with posted-only deposits", async () => {
    expect(store).toHaveProperty("buildReservationListAmounts");
    const f = fixture();
    const rows = await store.buildReservationListAmounts(
      { tenantId: "t1", reservationIds: ["r1"], timezone: "Asia/Kuala_Lumpur" },
      f.db,
    );
    expect(rows).toEqual([
      {
        id: "r1",
        currency: "MYR",
        totalAmount: 1114.55,
        depositAmount: 50,
        hasUnconfirmedDeposit: true,
      },
    ]);
    expect(f.calls.every((c) => c.filters.some(([k, v]) => k === "tenant_id" && v === "t1"))).toBe(
      true,
    );
    expect(f.calls.filter((c) => c.table === "hotel_reservations")).toHaveLength(1);
    expect(f.calls.some((c) => c.table === "hotel_guests" || c.table === "hotel_user_roles")).toBe(
      false,
    );
  });
  it("does not invent a deposit figure for a conflicting currency", async () => {
    const f = fixture();
    f.tables.hotel_reservation_deposits[0].currency_code = "USD";
    const rows = await store.buildReservationListAmounts(
      { tenantId: "t1", reservationIds: ["r1"], timezone: "Asia/Kuala_Lumpur" },
      f.db,
    );
    expect(rows[0]).toMatchObject({ totalAmount: 1114.55, depositAmount: null });
  });
  it("makes no database calls for an empty list page", async () => {
    const f = fixture();
    expect(
      await store.buildReservationListAmounts(
        { tenantId: "t1", reservationIds: [], timezone: "Asia/Kuala_Lumpur" },
        f.db,
      ),
    ).toEqual([]);
    expect(f.calls).toEqual([]);
  });
});
