import { describe, expect, it } from "vitest";
import { settlementFixture } from "./fixtures/settlement";
import { preparedSettlementFolio } from "./fixtures/settlement-folio";
import {
  loadSettlementSnapshot,
  snapshotDigest,
  type SnapshotDeps,
  type SnapshotFacts,
} from "../settlement-snapshot.server";
import type { SettlementActor } from "../settlement-context.server";

const actor: SettlementActor = {
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  n3UserKey: "synthetic-owner",
  n3Token: "synthetic-token",
  role: "owner",
};
function facts(): SnapshotFacts {
  const { digest: _digest, ...s } = settlementFixture();
  return {
    ...s,
    prepared: true,
    reservationStatus: "checked_in",
    historyGap: false,
    blockers: [],
    lines: s.lines.map((l) => ({ ...l, status: "active", reversesLineId: null })),
    sourceVersions: [
      { table: "hotel_reservations", id: s.reservationId, version: "2026-10-08T00:00:00Z" },
    ],
  };
}
function deps(f: SnapshotFacts = facts()): SnapshotDeps {
  return {
    readFacts: async () => f,
    verifyLine: async (_actor, line) => ({ kind: "confirmed", value: line }),
    verifyReceipt: async (_actor, receipt) => ({ kind: "confirmed", value: receipt }),
    now: () => new Date("2026-10-07T16:00:00Z"),
  };
}

describe("immutable settlement snapshot", () => {
  it("admits verified non-RFC N3 receipt and payment-account GUIDs", async () => {
    const f = facts();
    f.receipts[0].receiptId = "FFFFFFFF-FFFF-4FFF-0FFF-FFFFFFFFFFFF";
    f.receipts[0].payments[0].accountId = "11111111-1111-6111-f111-111111111111";
    const result = await loadSettlementSnapshot(actor, deps(f));
    expect(result.kind).toBe("confirmed");
    if (result.kind !== "confirmed") return;
    expect(result.value.receipts[0].receiptId).toBe("FFFFFFFF-FFFF-4FFF-0FFF-FFFFFFFFFFFF");
    expect(result.value.receipts[0].payments[0].accountId).toBe(
      "11111111-1111-6111-f111-111111111111",
    );
  });
  it("rejects one N3 receipt represented with two letter cases", async () => {
    const f = facts();
    f.receipts.push({ ...f.receipts[0], receiptId: f.receipts[0].receiptId.toUpperCase() });
    expect((await loadSettlementSnapshot(actor, deps(f))).kind).toBe("contradiction");
  });
  it.each(["00000000-0000-0000-0000-000000000000", "not-a-guid"])(
    "rejects invalid N3 receipt and payment account %s",
    async (id) => {
      const f = facts();
      f.receipts[0].receiptId = id;
      expect((await loadSettlementSnapshot(actor, deps(f))).kind).toBe("contradiction");
      const g = facts();
      g.receipts[0].payments[0].accountId = id;
      expect((await loadSettlementSnapshot(actor, deps(g))).kind).toBe("contradiction");
    },
  );
  it("retains local deposit UUID validation for otherwise valid N3 GUIDs", async () => {
    const f = facts();
    f.receipts[0].depositId = "eeeeeeee-eeee-4eee-0eee-eeeeeeeeeeee";
    expect((await loadSettlementSnapshot(actor, deps(f))).kind).toBe("contradiction");
  });
  it("requires external proof even for valid non-RFC N3 GUIDs", async () => {
    const f = facts();
    f.receipts[0].receiptId = "ffffffff-ffff-4fff-0fff-ffffffffffff";
    const d = deps(f);
    d.verifyReceipt = async () => ({ kind: "unavailable", code: "receipt_not_verified" });
    expect(await loadSettlementSnapshot(actor, d)).toEqual({
      kind: "unavailable",
      code: "receipt_not_verified",
    });
  });
  it("persists the faithful prepared folio projection inside the frozen digest", async () => {
    const f = facts();
    f.folioProjection = { version: 1, folio: preparedSettlementFolio() };
    const result = await loadSettlementSnapshot(actor, deps(f));
    expect(result.kind).toBe("confirmed");
    if (result.kind !== "confirmed") return;
    expect(result.value.folioProjection?.folio.lines[0]).toMatchObject({
      amount: 500,
      canEditQuantity: false,
      canReverse: false,
    });
    const frozenDigest = result.value.digest;
    f.folioProjection.folio.lines[0].description = "Changed later";
    expect(result.value.folioProjection?.folio.lines[0].description).toBe("Room charge");
    const { digest: _digest, ...frozen } = result.value;
    expect(snapshotDigest({ ...frozen, folioProjection: f.folioProjection })).not.toBe(
      frozenDigest,
    );
  });
  it("rejects inconsistent prepared print facts before freezing", async () => {
    const f = facts();
    const folio = preparedSettlementFolio();
    folio.totals.grandTotal = 900;
    f.folioProjection = { version: 1, folio };
    expect((await loadSettlementSnapshot(actor, deps(f))).kind).toBe("contradiction");
  });
  it.each([{ currencyId: 0 }, { currencyRate: 0 }])(
    "rejects invalid frozen currency header %j",
    async (override) => {
      const f = Object.assign(facts(), override);
      expect(await loadSettlementSnapshot(actor, deps(f))).toEqual({
        kind: "contradiction",
        code: "invalid_settlement_header",
      });
    },
  );
  it("rejects a quantity whose price cannot produce the prepared subtotal", async () => {
    const f = facts();
    f.lines[0].qty = 2;
    expect(await loadSettlementSnapshot(actor, deps(f))).toEqual({
      kind: "contradiction",
      code: "invalid_charge_snapshot",
    });
  });
  it("rejects malformed billing contact before any posting intent", async () => {
    const f = facts();
    f.billTo.name = "";
    expect(await loadSettlementSnapshot(actor, deps(f))).toEqual({
      kind: "contradiction",
      code: "invalid_bill_to_snapshot",
    });
  });
  it("builds the prepared total with independently dated linked deposits", async () => {
    const result = await loadSettlementSnapshot(actor, deps());
    expect(result.kind).toBe("confirmed");
    if (result.kind !== "confirmed") throw new Error(result.code);
    expect(result.value.totalCents).toBe(50000);
    expect(result.value.billDate).toBe("2026-10-08");
    expect(result.value.receipts[0].receiptDate).toBe("2026-09-30");
    expect(result.value.digest).toMatch(/^[a-f0-9]{64}$/);
  });
  it("same_customer_foreign_receipt_is_excluded by refusing corrupt scope", async () => {
    const f = facts();
    f.receipts[0].reservationId = "11111111-1111-4111-8111-111111111111";
    expect(await loadSettlementSnapshot(actor, deps(f))).toEqual({
      kind: "contradiction",
      code: "receipt_scope_mismatch",
    });
  });
  it("reversed_pair_does_not_double_charge while unrelated equal amount survives", async () => {
    const f = facts();
    const original = { ...f.lines[0], kind: "add_on", status: "reversed" };
    f.lines = [
      original,
      {
        ...original,
        localLineId: "22222222-2222-4222-8222-222222222222",
        kind: "reversal",
        status: "active",
        reversesLineId: original.localLineId,
        unitCents: -50000,
        subtotalCents: -50000,
        taxCents: 0,
        totalCents: -50000,
      },
      { ...original, localLineId: "33333333-3333-4333-8333-333333333333", status: "active" },
    ];
    const r = await loadSettlementSnapshot(actor, deps(f));
    expect(r.kind).toBe("confirmed");
    if (r.kind === "confirmed")
      expect(r.value.lines.map((l) => l.localLineId)).toEqual([
        "33333333-3333-4333-8333-333333333333",
      ]);
  });
  it("rejects an unpaired or financially different reversal", async () => {
    const f = facts();
    f.lines[0].status = "reversed";
    expect((await loadSettlementSnapshot(actor, deps(f))).kind).toBe("contradiction");
    f.lines[0].status = "active";
    f.lines.push({
      ...f.lines[0],
      localLineId: "22222222-2222-4222-8222-222222222222",
      kind: "reversal",
      reversesLineId: f.lines[0].localLineId,
      subtotalCents: -40000,
      totalCents: -40000,
    });
    expect((await loadSettlementSnapshot(actor, deps(f))).kind).toBe("contradiction");
  });
  it("later_settings_cannot_reprice_snapshot or mutate confirmed receipt facts", async () => {
    const f = facts();
    const r = await loadSettlementSnapshot(actor, deps(f));
    expect(r.kind).toBe("confirmed");
    if (r.kind !== "confirmed") throw new Error(r.code);
    f.lines[0].unitCents = 90000;
    f.receipts[0].payments[0].amountCents = 1;
    expect(r.value.lines[0].unitCents).toBe(50000);
    expect(r.value.receipts[0].payments[0].amountCents).toBe(5000);
  });
  it("unsupported_rounding_mapping_blocks", async () => {
    const f = facts();
    f.blockers = ["unsupported_rounding_mapping"];
    expect(await loadSettlementSnapshot(actor, deps(f))).toEqual({
      kind: "unavailable",
      code: "unsupported_rounding_mapping",
    });
  });
  it("snapshot_read_creates_nothing and uses the actor scope for every read", async () => {
    const calls: string[] = [];
    const d = deps();
    d.readFacts = async (scope) => {
      expect(scope).toEqual({ tenantId: actor.tenantId, reservationId: actor.reservationId });
      calls.push("read");
      return facts();
    };
    d.verifyReceipt = async (a, r) => {
      expect(a).toBe(actor);
      calls.push("receipt-read");
      return { kind: "confirmed", value: r };
    };
    expect((await loadSettlementSnapshot(actor, d)).kind).toBe("confirmed");
    expect(calls).toEqual(["read", "receipt-read"]);
  });
  it("historical_charge_gap_blocks", async () => {
    const f = facts();
    f.historyGap = true;
    expect(await loadSettlementSnapshot(actor, deps(f))).toEqual({
      kind: "unavailable",
      code: "historical_charge_evidence_incomplete",
    });
  });
  it.each(["confirmed", "checked_out"])(
    "requires a checked-in prepared folio: %s",
    async (status) => {
      const f = facts();
      f.reservationStatus = status;
      expect((await loadSettlementSnapshot(actor, deps(f))).kind).toBe("contradiction");
    },
  );
  it("requires exact line reconciliation and active integer master identities", async () => {
    const f = facts();
    f.totalCents = 60000;
    expect((await loadSettlementSnapshot(actor, deps(f))).kind).toBe("contradiction");
    f.totalCents = 50000;
    f.lines[0].stockId = 0;
    expect((await loadSettlementSnapshot(actor, deps(f))).kind).toBe("contradiction");
  });
  it("rejects verified receipt identity drift and duplicate receipt candidates", async () => {
    const d = deps();
    d.verifyReceipt = async (_a, r) => ({ kind: "confirmed", value: { ...r, amountCents: 6500 } });
    expect((await loadSettlementSnapshot(actor, d)).kind).toBe("contradiction");
    const f = facts();
    f.receipts.push({ ...f.receipts[0] });
    expect((await loadSettlementSnapshot(actor, deps(f))).kind).toBe("contradiction");
  });
  it("digest is independent of object key order, but preserves financial differences", () => {
    const { digest: _d, ...a } = settlementFixture();
    const b = {
      ...a,
      billTo: { email: "", phone: "", address: "", company: "", name: "Synthetic guest" },
    };
    expect(snapshotDigest(a)).toBe(snapshotDigest(b));
    expect(snapshotDigest({ ...a, totalCents: 50001 })).not.toBe(snapshotDigest(a));
  });
  it("failed external reads remain unavailable", async () => {
    const d = deps();
    d.readFacts = async () => {
      throw new Error("read failed");
    };
    expect(await loadSettlementSnapshot(actor, d)).toEqual({
      kind: "unavailable",
      code: "settlement_snapshot_read_failed",
    });
  });
});
