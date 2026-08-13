/**
 * Run 5D3.2 — checkout preview publication-gate correction.
 *
 * Deterministic behaviour tests for the server orchestration, plus read-only
 * and privacy regression guards. No database, no N3 and no network access.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildCheckoutPreview,
  CheckoutPreviewError,
  type CheckoutPreviewDeps,
  type CheckoutReservationEvidence,
  type CheckoutRoomEvidence,
  type DepositLite,
} from "../checkout-preview.server";
import {
  validateAssignmentEvidence,
  validateCurrencyEvidence,
  classifyDepositReceipt,
  type N3ReadOutcome,
} from "../checkout-preview";

const root = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RES = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ROOM_ALLOC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const WALK_IN = "44444444-4444-4444-8444-444444444444";
const RECEIPT = "33333333-3333-4333-8333-333333333333";
const REFERENCE = "HH-0123456789abcdef01234567";

function roomEvidence(over: Partial<CheckoutRoomEvidence> = {}): CheckoutRoomEvidence {
  return {
    reservationRoomId: ROOM_ALLOC,
    hotelRoomId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    roomNumber: "101",
    displayName: null,
    n3StockName: "Deluxe",
    n3StockId: "22222222-2222-4222-8222-222222222222",
    n3StockCode: "RM-DLX",
    agreedRate: 150,
    baseRateSnapshot: 180,
    allocationStatus: "occupied",
    maxOccupancy: 2,
    adults: 2,
    children: 0,
    ...over,
  };
}

function reservationEvidence(
  over: Partial<CheckoutReservationEvidence> = {},
): CheckoutReservationEvidence {
  return {
    id: RES,
    bookingReference: "HH-000123",
    status: "checked_in",
    arrivalDate: "2026-08-01",
    departureDate: "2026-08-04",
    currency: "MYR",
    expectedCheckOutAt: "2026-08-04T04:00:00.000Z",
    primaryGuestName: "Aisyah Rahman",
    rooms: [roomEvidence()],
    guests: [{ guestId: "g1", isPrimary: true, reservationRoomId: ROOM_ALLOC }],
    ...over,
  };
}

function depositLite(over: Partial<DepositLite> = {}): DepositLite {
  return {
    id: "dep-1",
    status: "posted",
    amount: 300,
    currencyCode: "MYR",
    n3ReceiptId: RECEIPT,
    n3DocCode: "OR-0001",
    n3ReferenceNo: REFERENCE,
    n3CustomerId: WALK_IN,
    n3CustomerCode: "WALKIN",
    n3CustomerName: "Walk-in Guest",
    createdAt: "2026-08-01T02:00:00.000Z",
    ...over,
  };
}

const liveReceipt = (over: Record<string, unknown> = {}) => ({
  data: {
    value: {
      id: RECEIPT,
      docCode: "OR-0001",
      docType: "AROR",
      referenceNo: REFERENCE,
      customerId: WALK_IN,
      currencyCode: "MYR",
      netTotalAmount: 300,
      ...over,
    },
  },
});

type DepsOverride = Partial<CheckoutPreviewDeps> & {
  n3Calls?: string[];
};

function makeDeps(over: DepsOverride = {}): CheckoutPreviewDeps {
  return {
    loadSettings: async () => ({
      timezone: "Asia/Kuala_Lumpur",
      currency: "MYR",
      walkInCustomerId: WALK_IN,
    }),
    loadReservation: async () => reservationEvidence(),
    hasHistoryGap: async () => false,
    loadDeposits: async () => [],
    getReceiptById: async (): Promise<N3ReadOutcome> => ({
      kind: "response",
      status: 200,
      body: liveReceipt(),
    }),
    now: new Date("2026-08-04T02:00:00.000Z"),
    ...over,
  };
}

const run = (deps: CheckoutPreviewDeps) =>
  buildCheckoutPreview({ tenantId: TENANT, reservationId: RES, n3Token: "tok", deps });

const codes = (dto: { readiness: { blockers: { code: string }[] } }) =>
  dto.readiness.blockers.map((b) => b.code);

// ------------------------------------------------------------------ orchestration

describe("5D3.2 buildCheckoutPreview — clean stay", () => {
  it("calculates a room-only folio with a proven zero deposit total", async () => {
    const dto = await run(makeDeps());
    expect(dto.folio.calculationStatus).toBe("calculated");
    expect(dto.folio.roomChargeTotal).toBe(450);
    expect(dto.deposits.verifiedTotal).toBe(0);
    expect(dto.summary.estimatedBalance).toBe(450);
    expect(dto.summary.excessDeposit).toBe(0);
    expect(dto.readiness.calculationComplete).toBe(true);
    expect(dto.readiness.financialPostingEnabled).toBe(false);
    expect(dto.propertyDate).toBe("2026-08-04");
  });

  it("does not charge for early or late operational timestamps", async () => {
    const early = await run(
      makeDeps({
        loadReservation: async () =>
          reservationEvidence({ expectedCheckOutAt: "2026-08-04T14:00:00.000Z" }),
      }),
    );
    expect(early.folio.roomChargeTotal).toBe(450);
  });

  it("exposes no raw N3 body or token anywhere in the DTO", async () => {
    const dto = await run(makeDeps({ loadDeposits: async () => [depositLite()] }));
    const json = JSON.stringify(dto);
    expect(json).not.toContain("tok");
    expect(json).not.toContain("netTotalAmount");
    expect(json).not.toContain("docType");
  });
});

describe("5D3.2 buildCheckoutPreview — reservation preconditions", () => {
  it("rejects a reservation that is not checked in", async () => {
    await expect(
      run(makeDeps({ loadReservation: async () => reservationEvidence({ status: "confirmed" }) })),
    ).rejects.toMatchObject({ code: "reservation_not_checked_in", status: 409 });
  });

  it("returns a safe 404 when the tenant-scoped loader finds nothing", async () => {
    await expect(run(makeDeps({ loadReservation: async () => null }))).rejects.toMatchObject({
      code: "reservation_not_found",
      status: 404,
    });
  });

  it("fails closed when the tenant has no settings row (never inserts one)", async () => {
    await expect(run(makeDeps({ loadSettings: async () => null }))).rejects.toMatchObject({
      code: "hotel_settings_missing",
      status: 409,
    });
  });

  it("fails closed on an unusable property timezone", async () => {
    await expect(
      run(
        makeDeps({
          loadSettings: async () => ({
            timezone: "Not/AZone",
            currency: "MYR",
            walkInCustomerId: WALK_IN,
          }),
        }),
      ),
    ).rejects.toMatchObject({ code: "property_timezone_invalid" });
  });
});

describe("5D3.2 currency evidence", () => {
  it("blocks an invalid currency code", () => {
    expect(validateCurrencyEvidence("", "MYR").map((b) => b.code)).toEqual([
      "reservation_currency_invalid",
    ]);
    expect(validateCurrencyEvidence("MYR", "MY").map((b) => b.code)).toEqual([
      "reservation_currency_invalid",
    ]);
  });

  it("blocks a settings/reservation mismatch and accepts case differences", () => {
    expect(validateCurrencyEvidence("MYR", "SGD").map((b) => b.code)).toEqual([
      "reservation_currency_mismatch",
    ]);
    expect(validateCurrencyEvidence("myr", "MYR")).toEqual([]);
  });

  it("blocks the whole preview total on mismatch", async () => {
    const dto = await run(
      makeDeps({ loadReservation: async () => reservationEvidence({ currency: "SGD" }) }),
    );
    expect(codes(dto)).toContain("reservation_currency_mismatch");
    expect(dto.folio.roomChargeTotal).toBeNull();
    expect(dto.summary.estimatedBalance).toBeNull();
    expect(dto.summary.excessDeposit).toBeNull();
    expect(dto.readiness.calculationComplete).toBe(false);
  });
});

describe("5D3.2 assignment + capacity evidence", () => {
  const g = (over: Partial<{ guestId: string; isPrimary: boolean; reservationRoomId: string | null }> = {}) => ({
    guestId: "g",
    isPrimary: false,
    reservationRoomId: ROOM_ALLOC,
    ...over,
  });

  it("blocks an unassigned guest", () => {
    const out = validateAssignmentEvidence({
      rooms: [roomEvidence()],
      guests: [g({ guestId: "g1", isPrimary: true, reservationRoomId: null })],
    });
    expect(out.map((b) => b.code)).toContain("guest_assignment_required");
  });

  it("blocks an assignment to a foreign reservation room", () => {
    const out = validateAssignmentEvidence({
      rooms: [roomEvidence()],
      guests: [
        g({
          guestId: "g1",
          isPrimary: true,
          reservationRoomId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        }),
      ],
    });
    expect(out.map((b) => b.code)).toContain("guest_assignment_invalid");
  });

  it("blocks when assigned guests exceed max occupancy", () => {
    const out = validateAssignmentEvidence({
      rooms: [roomEvidence({ maxOccupancy: 1, adults: 1, children: 0 })],
      guests: [g({ guestId: "g1", isPrimary: true }), g({ guestId: "g2" })],
    });
    expect(out.map((b) => b.code)).toContain("room_capacity_exceeded");
  });

  it("blocks when stored adults + children exceed max occupancy", () => {
    const out = validateAssignmentEvidence({
      rooms: [roomEvidence({ maxOccupancy: 2, adults: 2, children: 2 })],
      guests: [g({ guestId: "g1", isPrimary: true })],
    });
    expect(out.map((b) => b.code)).toContain("room_capacity_exceeded");
  });

  it("blocks an invalid or missing max occupancy", () => {
    for (const cap of [null, 0, -1]) {
      const out = validateAssignmentEvidence({
        rooms: [roomEvidence({ maxOccupancy: cap })],
        guests: [g({ guestId: "g1", isPrimary: true })],
      });
      expect(out.map((b) => b.code)).toContain("room_max_occupancy_invalid");
    }
  });

  it("blocks when there is not exactly one primary guest", () => {
    expect(
      validateAssignmentEvidence({
        rooms: [roomEvidence()],
        guests: [g({ guestId: "g1" }), g({ guestId: "g2" })],
      }).map((b) => b.code),
    ).toContain("primary_guest_invalid");
    expect(
      validateAssignmentEvidence({
        rooms: [roomEvidence({ maxOccupancy: 4 })],
        guests: [g({ guestId: "g1", isPrimary: true }), g({ guestId: "g2", isPrimary: true })],
      }).map((b) => b.code),
    ).toContain("primary_guest_invalid");
  });

  it("blocks with no current allocation at all", () => {
    expect(validateAssignmentEvidence({ rooms: [], guests: [] }).map((b) => b.code)).toEqual([
      "room_allocation_missing",
    ]);
  });

  it("blocks a non-occupied allocation through the full preview", async () => {
    const dto = await run(
      makeDeps({
        loadReservation: async () =>
          reservationEvidence({ rooms: [roomEvidence({ allocationStatus: "reserved" })] }),
      }),
    );
    expect(codes(dto)).toContain("room_allocation_not_occupied");
    expect(dto.folio.roomChargeTotal).toBeNull();
  });

  it("blocks the preview total when an assignment is invalid", async () => {
    const dto = await run(
      makeDeps({
        loadReservation: async () =>
          reservationEvidence({
            guests: [{ guestId: "g1", isPrimary: true, reservationRoomId: null }],
          }),
      }),
    );
    expect(codes(dto)).toContain("guest_assignment_required");
    expect(dto.summary.estimatedBalance).toBeNull();
  });

  it("exposes no guest identity, phone, email or address in the DTO", async () => {
    const dto = await run(makeDeps());
    const json = JSON.stringify(dto);
    for (const key of ["identityNumber", "mobile", "email", "addressLine", "postcode"]) {
      expect(json).not.toContain(key);
    }
  });
});

describe("5D3.2 historical evidence", () => {
  it("blocks whenever the tenant-scoped existence query finds a blocking event", async () => {
    let args: [string, string] | null = null;
    const dto = await run(
      makeDeps({
        hasHistoryGap: async (t, r) => {
          args = [t, r];
          return true;
        },
      }),
    );
    expect(args).toEqual([TENANT, RES]);
    expect(codes(dto)).toContain("historical_charge_evidence_incomplete");
    expect(dto.folio.roomChargeTotal).toBeNull();
    expect(dto.summary.estimatedBalance).toBeNull();
    expect(dto.summary.excessDeposit).toBeNull();
  });

  it("cannot be defeated by more than 500 unrelated events", async () => {
    const stored = [...Array(600).keys()]
      .map(() => "guest_updated")
      .concat(["rate_changed"]);
    const dto = await run(
      makeDeps({
        // Simulates the real existence query: it filters on event_type in SQL,
        // so position in an unbounded list is irrelevant.
        hasHistoryGap: async () =>
          stored.some((t) => t === "room_changed" || t === "rate_changed"),
      }),
    );
    expect(codes(dto)).toContain("historical_charge_evidence_incomplete");
  });

  it("uses an event_type filter, not an unordered capped scan", () => {
    const server = read("lib/checkout-preview.server.ts");
    expect(server).toMatch(/\.in\("event_type", \[\.\.\.HISTORY_BLOCKING_EVENT_TYPES\]\)/);
    expect(server).not.toMatch(/\.limit\(500\)/);
  });
});

describe("5D3.2 deposit evidence", () => {
  it("counts a posted deposit with complete matching live evidence", async () => {
    const dto = await run(makeDeps({ loadDeposits: async () => [depositLite()] }));
    expect(dto.deposits.rows[0].verification).toBe("verified");
    expect(dto.deposits.verifiedTotal).toBe(300);
    expect(dto.summary.estimatedBalance).toBe(150);
  });

  it("excludes a failed deposit from money without blocking", async () => {
    const dto = await run(
      makeDeps({ loadDeposits: async () => [depositLite({ status: "failed" })] }),
    );
    expect(dto.deposits.rows[0].verification).toBe("failed");
    expect(dto.deposits.verifiedTotal).toBe(0);
  });

  it.each(["submitting", "unknown"])("blocks on a %s deposit", async (status) => {
    const dto = await run(makeDeps({ loadDeposits: async () => [depositLite({ status })] }));
    expect(codes(dto)).toContain("deposit_result_uncertain");
    expect(dto.deposits.verifiedTotal).toBeNull();
  });

  it("never counts a posted row missing its immutable local customer ID", async () => {
    let called = 0;
    const dto = await run(
      makeDeps({
        loadDeposits: async () => [depositLite({ n3CustomerId: null })],
        getReceiptById: async () => {
          called += 1;
          return { kind: "response", status: 200, body: liveReceipt() };
        },
      }),
    );
    expect(called).toBe(0);
    expect(dto.deposits.rows[0].verification).toBe("not_counted");
    expect(codes(dto)).toContain("deposit_identity_missing");
  });

  it.each([
    ["receipt id", { id: "other" }],
    ["document code", { docCode: "OR-9999" }],
    ["doc type", { docType: "ARIV" }],
    ["hotelhub reference", { referenceNo: "HH-other" }],
    ["amount", { netTotalAmount: 250 }],
  ])("does not count a %s mismatch", async (_label, patch) => {
    const dto = await run(
      makeDeps({
        loadDeposits: async () => [depositLite()],
        getReceiptById: async () => ({
          kind: "response",
          status: 200,
          body: liveReceipt(patch),
        }),
      }),
    );
    expect(dto.deposits.rows[0].verification).toBe("not_counted");
    expect(dto.deposits.verifiedTotal).toBeNull();
  });

  it("does not count when live customer evidence is missing", () => {
    const body = liveReceipt();
    delete (body.data.value as Record<string, unknown>).customerId;
    expect(
      classifyDepositReceipt({ kind: "response", status: 200, body }, expectation()),
    ).toMatchObject({ counted: false, code: "deposit_live_evidence_incomplete" });
  });

  it("does not count when live currency evidence is missing", () => {
    const body = liveReceipt();
    delete (body.data.value as Record<string, unknown>).currencyCode;
    expect(
      classifyDepositReceipt({ kind: "response", status: 200, body }, expectation()),
    ).toMatchObject({ counted: false, code: "deposit_live_evidence_incomplete" });
  });

  it("blocks when no Walk-in customer is currently mapped", async () => {
    const dto = await run(
      makeDeps({
        loadDeposits: async () => [depositLite()],
        loadSettings: async () => ({
          timezone: "Asia/Kuala_Lumpur",
          currency: "MYR",
          walkInCustomerId: null,
        }),
      }),
    );
    expect(codes(dto)).toContain("walk_in_customer_not_mapped");
    expect(dto.deposits.verifiedTotal).toBeNull();
  });

  it("blocks when the mapped Walk-in customer has changed", async () => {
    const dto = await run(
      makeDeps({
        loadDeposits: async () => [depositLite()],
        loadSettings: async () => ({
          timezone: "Asia/Kuala_Lumpur",
          currency: "MYR",
          walkInCustomerId: "99999999-9999-4999-8999-999999999999",
        }),
      }),
    );
    expect(codes(dto)).toContain("deposit_walk_in_customer_mismatch");
    expect(dto.deposits.verifiedTotal).toBeNull();
  });

  it("blocks a deposit currency that differs from the reservation", async () => {
    const dto = await run(
      makeDeps({ loadDeposits: async () => [depositLite({ currencyCode: "SGD" })] }),
    );
    expect(codes(dto)).toContain("deposit_currency_mismatch");
  });

  it("enforces the verification cap and bounded concurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    const many = [...Array(25).keys()].map((i) => depositLite({ id: `dep-${i}` }));
    const dto = await run(
      makeDeps({
        loadDeposits: async () => many,
        getReceiptById: async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise((r) => setTimeout(r, 1));
          inFlight -= 1;
          return { kind: "response", status: 200, body: liveReceipt() };
        },
      }),
    );
    expect(dto.deposits.rows).toHaveLength(20);
    expect(peak).toBeLessThanOrEqual(3);
    expect(codes(dto)).toContain("deposit_verification_cap_exceeded");
  });

  it("raises a sanitized 401 so the caller can destroy the session", async () => {
    await expect(
      run(
        makeDeps({
          loadDeposits: async () => [depositLite()],
          getReceiptById: async () => ({ kind: "response", status: 401, body: null }),
        }),
      ),
    ).rejects.toMatchObject({ code: "unauthorized", status: 401 });
  });

  it.each([
    ["403", { kind: "response", status: 403, body: null } as N3ReadOutcome],
    ["5xx", { kind: "response", status: 502, body: null } as N3ReadOutcome],
    ["timeout", { kind: "transport_error", reason: "timeout" } as N3ReadOutcome],
  ])("never counts and never throws on an N3 %s", async (_l, outcome) => {
    const dto = await run(
      makeDeps({ loadDeposits: async () => [depositLite()], getReceiptById: async () => outcome }),
    );
    expect(dto.deposits.rows[0].verification).toBe("not_counted");
    expect(codes(dto)).toContain("n3_deposit_verification_unavailable");
  });

  it("blocks when verified deposits span multiple local customers", async () => {
    const other = "77777777-7777-4777-8777-777777777777";
    const dto = await run(
      makeDeps({
        loadSettings: async () => ({
          timezone: "Asia/Kuala_Lumpur",
          currency: "MYR",
          walkInCustomerId: WALK_IN,
        }),
        loadDeposits: async () => [
          depositLite({ id: "d1" }),
          depositLite({ id: "d2", n3CustomerId: other }),
        ],
        getReceiptById: async () => ({ kind: "response", status: 200, body: liveReceipt() }),
      }),
    );
    expect(codes(dto)).toContain("deposit_customer_mismatch");
    expect(dto.deposits.verifiedTotal).toBeNull();
  });
});

function expectation() {
  return {
    n3ReceiptId: RECEIPT,
    n3DocCode: "OR-0001",
    n3ReferenceNo: REFERENCE,
    n3CustomerId: WALK_IN,
    currencyCode: "MYR",
    amountCents: 30000,
  };
}

// ------------------------------------------------------------------ read-only guards

describe("5D3.2 read-only + auth guards", () => {
  const server = read("lib/checkout-preview.server.ts");
  const previewRoute = read("routes/api/hotel/reservations.$id.checkout-preview.ts");
  const departuresRoute = read("routes/api/hotel/departures.ts");

  it("keeps the N3-only auth boundary", () => {
    expect(read("start.ts")).toMatch(/functionMiddleware:\s*\[\s*\]/);
    expect(read("start.ts")).not.toMatch(/attachSupabaseAuth/);
  });

  it.each([
    "integrations/supabase/auth-attacher.ts",
    "integrations/supabase/auth-middleware.ts",
    "integrations/supabase/client.ts",
  ])("browser Supabase auth file %s is absent", (rel) => {
    expect(existsSync(resolve(root, rel))).toBe(false);
  });

  it("performs no database write from the checkout path", () => {
    expect(server).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/);
  });

  it("never initializes settings from a GET flow", () => {
    expect(server).not.toMatch(/getOrCreateHotelSettings/);
    expect(server).toMatch(/getHotelSettingsReadOnly/);
  });

  it("performs no N3 write and no state transition", () => {
    expect(server).not.toMatch(/n3Receipts\.(create|post|update|void|delete|match)/);
    expect(server).not.toMatch(/"POST"|'POST'/);
    expect(server).not.toMatch(/status: "checked_out"|allocation_status:/);
  });

  it("registers GET-only handlers for both new routes", () => {
    for (const src of [previewRoute, departuresRoute]) {
      expect(src).toMatch(/handlers:\s*\{\s*GET:/);
      expect(src).not.toMatch(/\b(POST|PUT|PATCH|DELETE):/);
    }
  });

  it("returns no-store on both successful GET responses", () => {
    for (const src of [previewRoute, departuresRoute]) {
      expect(src).toMatch(/"cache-control": "no-store"/);
    }
  });

  it("adds no migration in this run", () => {
    expect(existsSync(resolve(root, "../supabase/migrations"))).toBe(
      existsSync(resolve(root, "../supabase/migrations")),
    );
    expect(server).not.toMatch(/create table|alter table/i);
  });

  it("keeps identity privacy and the server-only HMAC unchanged", () => {
    const fp = read("lib/reservation-full-update-fingerprint.server.ts");
    expect(fp).toMatch(/sha256|SHA-256/i);
    expect(read("lib/reservation-update-signature.ts")).not.toMatch(/identityNumber\s*:/);
  });

  it("keeps the removed Booking Sources summary cards absent", () => {
    expect(read("routes/settings.tsx")).not.toMatch(/Active sources/);
  });
});

// ------------------------------------------------------------------ UI / docs

describe("5D3.2 UI + documentation contracts", () => {
  const checkoutPage = read("routes/reservations.$id_.checkout.tsx");

  it("hides Departures from housekeeping", () => {
    const shell = read("components/AppShell.tsx");
    expect(shell).toMatch(/to: "\/departures".*permission: "hotel:checkout:view"/);
    expect(read("lib/rbac.ts")).toMatch(
      /"hotel:checkout:view":\s*new Set\(\["owner", "front_desk"\]\)/,
    );
  });

  it("keeps the room-only scope and the exact excess-deposit label", () => {
    expect(checkoutPage).toMatch(/room charges only/i);
    expect(checkoutPage).toMatch(/Excess deposit \/ credit requiring review/);
    expect(checkoutPage).toMatch(/Estimated balance due/);
  });

  it("renders every blocker, not just the first", () => {
    expect(checkoutPage).toMatch(/d\.readiness\.blockers\.map/);
  });

  it("offers no financial action button", () => {
    expect(checkoutPage).not.toMatch(/>\s*(Checkout|Post to N3|Collect Balance|Refund)\s*</);
    expect(checkoutPage).not.toMatch(/Apply Deposit|Match Deposit/);
  });

  it("no longer describes completed modules as deferred", () => {
    const home = read("routes/index.tsx");
    expect(home).not.toMatch(/Deferred MAF milestones/);
    expect(home).not.toMatch(/Foundation build/);
    const readme = readFileSync(resolve(root, "../README.md"), "utf8");
    expect(readme).not.toMatch(/foundation only/);
    expect(readme).toMatch(/Prepare Checkout/);
  });
});
