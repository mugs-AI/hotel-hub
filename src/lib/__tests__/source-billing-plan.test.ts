import { describe, expect, it } from "vitest";
import { partitionSourceBill } from "../source-billing-plan.server";
import { settlementFixture } from "./fixtures/settlement";
import { snapshotDigest } from "../settlement-snapshot.server";
import type { ChargeLine, SettlementSnapshot } from "../settlement";
import type { ReservationPayerSnapshot, BillingLegKind } from "../source-billing";
const sourceId = "22222222-2222-4222-8222-222222222222";
const roomId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const extraId = "33333333-3333-4333-8333-333333333333";
const legIds = {
  source: "44444444-4444-4444-8444-444444444444",
  guest: "55555555-5555-4555-8555-555555555555",
};
const payer = (mode: "source" | "guest" = "source"): ReservationPayerSnapshot => ({
  policy: {
    sourceId,
    version: "1",
    defaultCollectionMode: "source",
    allowedCollectionModes: ["source", "guest"],
    sourceCustomerId: 8,
    guestCustomerId: 7,
    guestDocumentTitle: "Agoda Sales",
    guestItemDescription: "Accommodation handled by booking source",
    showRoomPrices: false,
  },
  collectionMode: mode,
  confirmedBy: "owner",
  confirmedAt: "2026-10-12T00:00:00.000Z",
});
function seal(s: SettlementSnapshot) {
  const { digest: _d, ...facts } = s;
  return { ...facts, digest: snapshotDigest(facts) };
}
function line(id: string, kind: string, subtotal: number, tax = 0): ChargeLine {
  return {
    ...settlementFixture().lines[0],
    localLineId: id,
    kind,
    unitCents: subtotal,
    subtotalCents: subtotal,
    taxCents: tax,
    totalCents: subtotal + tax,
    description: kind,
  };
}
function fixture(extra = 8000) {
  return seal(
    settlementFixture({
      lines: [line(roomId, "room_night", 30000), line(extraId, "add_on", extra)],
      totalCents: 30000 + extra,
    }),
  );
}
function customers(s = fixture()) {
  return new Map([
    [
      8,
      {
        tenantId: s.tenantId,
        customerId: 8,
        currencyId: 1,
        currencyRate: 1,
        billTo: { name: "Synthetic OTA", company: "", address: "", phone: "", email: "" },
      },
    ],
  ]);
}
function result(s = fixture(), p = payer(), a: ReadonlyMap<string, BillingLegKind> = new Map()) {
  return partitionSourceBill(s, p, a, legIds, customers(s));
}
function confirmed(r: ReturnType<typeof result>) {
  expect(r.kind).toBe("confirmed");
  if (r.kind !== "confirmed") throw Error(r.code);
  return r.value;
}
describe("immutable source and guest bill partition", () => {
  it.each([8000, 4000])(
    "splits RM300 room and RM%d cents extras without netting commission",
    (extra) => {
      const plan = confirmed(result(fixture(extra)));
      expect(plan.legs.map((l) => [l.kind, l.customerId, l.snapshot.totalCents])).toEqual([
        ["source_room", 8, 30000],
        ["guest", 7, extra],
      ]);
      expect(plan.totalCents).toBe(30000 + extra);
      expect(plan.legs.flatMap((l) => l.snapshot.lines.map((x) => x.localLineId))).toEqual([
        roomId,
        extraId,
      ]);
      expect(plan.legs[0].snapshot.receipts).toEqual([]);
      expect(plan.legs[1].snapshot.receipts).toHaveLength(1);
      expect(plan.legs[0].snapshot.billTo.name).toBe("Synthetic OTA");
      expect(plan.legs[1].snapshot.billTo.name).toBe("Synthetic guest");
      expect(plan.legs[0].showPrices).toBe(false);
      expect(plan.legs[1].showPrices).toBe(true);
    },
  );
  it("Agoda/property collect and website guest stays remain one guest bill", () => {
    const plan = confirmed(result(fixture(), payer("guest")));
    expect(plan.legs).toHaveLength(1);
    expect(plan.legs[0]).toMatchObject({
      kind: "guest",
      customerId: 7,
      documentTitle: "Sales Invoice",
      showPrices: true,
    });
    expect(plan.legs[0].snapshot.totalCents).toBe(38000);
  });
  it("conserves each explicit discount, tax and rounding cent across multiple rooms", () => {
    const discountId = "66666666-6666-4666-8666-666666666666";
    const roundingId = "77777777-7777-4777-8777-777777777777";
    const secondRoomId = "88888888-8888-4888-8888-888888888888";
    const s = seal(
      settlementFixture({
        lines: [
          line(roomId, "room_night", 20000, 1600),
          line(secondRoomId, "room_night", 10000, 800),
          line(extraId, "add_on", 4000, 320),
          line(discountId, "discount", -1000, -80),
          line(roundingId, "rounding", 2),
        ],
        totalCents: 35642,
      }),
    );
    const plan = confirmed(
      result(
        s,
        payer(),
        new Map([
          [discountId, "source_room"],
          [roundingId, "guest"],
        ]),
      ),
    );
    for (const field of ["subtotalCents", "taxCents", "totalCents"] as const)
      expect(plan.legs.flatMap((l) => l.snapshot.lines).reduce((n, l) => n + l[field], 0)).toBe(
        s.lines.reduce((n, l) => n + l[field], 0),
      );
    expect(plan.totalCents).toBe(35642);
  });
  it("unassigned shared tax/levy/discount blocks rather than guessing", () => {
    const s = fixture();
    s.lines.push(line("66666666-6666-4666-8666-666666666666", "tourism_tax", 1000));
    s.totalCents += 1000;
    expect(result(seal(s))).toEqual({
      kind: "unavailable",
      code: "source_charge_attribution_required",
    });
  });
  it("refuses foreign guest receipt instead of assigning it to the source bill", () => {
    const s = fixture();
    s.receipts[0].customerId = 8;
    expect(result(seal(s))).toEqual({
      kind: "contradiction",
      code: "source_receipt_scope_mismatch",
    });
  });
  it("omits empty guest leg without dropping an unmatched guest advance", () => {
    const s = seal(
      settlementFixture({
        lines: [line(roomId, "room_night", 30000)],
        totalCents: 30000,
        receipts: [],
      }),
    );
    expect(confirmed(result(s)).legs.map((l) => l.kind)).toEqual(["source_room"]);
    s.receipts = settlementFixture().receipts;
    expect(result(seal(s))).toEqual({
      kind: "unavailable",
      code: "guest_advance_without_guest_bill",
    });
  });
  it("copies and freezes payer/lines without mutating input or later defaults", () => {
    const s = fixture(),
      p = payer(),
      plan = confirmed(result(s, p));
    p.policy.guestDocumentTitle = "Changed";
    s.lines[0].totalCents = 1;
    expect(plan.legs[0].documentTitle).toBe("Agoda Sales");
    expect(plan.legs[0].snapshot.totalCents).toBe(30000);
    expect(Object.isFrozen(plan.legs[0].snapshot.lines[0].mappingEvidence)).toBe(true);
    const { digest, ...facts } = plan.legs[0].snapshot;
    expect(digest).toBe(snapshotDigest(facts));
  });
  it("rejects duplicate line/leg IDs, unknown attribution and source attribution in guest mode", () => {
    const s = fixture();
    s.lines[1].localLineId = roomId;
    expect(result(seal(s)).kind).toBe("contradiction");
    expect(
      partitionSourceBill(
        fixture(),
        payer(),
        new Map(),
        { source: legIds.guest, guest: legIds.guest },
        customers(),
      ).kind,
    ).toBe("contradiction");
    expect(result(fixture(), payer(), new Map([["missing", "guest"]])).kind).toBe("contradiction");
    expect(result(fixture(), payer("guest"), new Map([[roomId, "source_room"]])).kind).toBe(
      "contradiction",
    );
  });
  it("requires exact source debtor contact/currency evidence; never relabels guest contact", () => {
    expect(partitionSourceBill(fixture(), payer(), new Map(), legIds)).toEqual({
      kind: "unavailable",
      code: "source_customer_snapshot_required",
    });
    const evidence = customers();
    evidence.get(8)!.tenantId = "other";
    expect(partitionSourceBill(fixture(), payer(), new Map(), legIds, evidence).kind).toBe(
      "contradiction",
    );
    evidence.get(8)!.tenantId = fixture().tenantId;
    evidence.get(8)!.currencyId = 2;
    expect(partitionSourceBill(fixture(), payer(), new Map(), legIds, evidence).kind).toBe(
      "contradiction",
    );
  });
  it("rejects tampered digest, malformed policy, unsafe money and hidden credentials", () => {
    const s = fixture();
    s.totalCents--;
    expect(result(s).kind).toBe("contradiction");
    const p = payer();
    p.policy.sourceCustomerId = 7;
    expect(result(fixture(), p).kind).toBe("contradiction");
    const large = fixture();
    large.lines[0].totalCents = Number.MAX_SAFE_INTEGER;
    expect(result(seal(large)).kind).toBe("contradiction");
    const secret = fixture();
    secret.lines[0].mappingEvidence = { authorization: "SECRET" };
    expect(result(seal(secret)).kind).toBe("contradiction");
  });
});
