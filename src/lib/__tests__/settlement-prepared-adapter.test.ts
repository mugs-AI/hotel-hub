import { describe, expect, it, vi } from "vitest";
import {
  loadPreparedSettlementSnapshot,
  type PreparedSnapshotPorts,
} from "../settlement-prepared-adapter.server";
import { snapshotDigest, type SnapshotFacts } from "../settlement-snapshot.server";
import { settlementFixture } from "./fixtures/settlement";
import { fixtureActor as actor } from "./fixtures/settlement-evidence";
import { preparedSettlementFolio } from "./fixtures/settlement-folio";
function setup() {
  const { digest: _d, ...s } = settlementFixture();
  const facts: SnapshotFacts = {
    ...s,
    lines: s.lines.map((l) => ({ ...l, status: "draft", reversesLineId: null })),
    prepared: true,
    reservationStatus: "checked_in",
    historyGap: false,
    blockers: [],
    sourceVersions: [{ table: "hotel_folios", id: s.folioId, version: "1" }],
    folioProjection: { version: 1, folio: preparedSettlementFolio() },
  };
  const ports: PreparedSnapshotPorts = {
    readFacts: vi.fn(async () => ({ kind: "confirmed" as const, value: structuredClone(facts) })),
    verifyLine: vi.fn(async (_a, line) => ({
      kind: "confirmed" as const,
      value: {
        ...line,
        mappingEvidence: {
          customerId: 7,
          customerCode: "WALKIN",
          arAccountId: "ar",
          arAccountCode: "AR",
          salesAccountId: "sales",
          salesAccountCode: "SALES",
        },
      },
    })),
    verifyReceipt: vi.fn(async (_a, _s, receipt) => ({
      kind: "confirmed" as const,
      value: receipt,
    })),
    now: () => new Date("2026-10-08T02:00:00Z"),
  };
  return { facts, ports };
}
describe("prepared facts to immutable settlement snapshot", () => {
  it("passes the mapped accounting graph to the receipt prover and never a raw local proof flag", async () => {
    const f = setup();
    const r = await loadPreparedSettlementSnapshot(actor, f.ports);
    expect(r.kind).toBe("confirmed");
    expect(f.ports.verifyReceipt).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        lines: [
          expect.objectContaining({
            mappingEvidence: expect.objectContaining({ customerCode: "WALKIN" }),
          }),
        ],
      }),
      expect.objectContaining({ receiptId: f.facts.receipts[0].receiptId }),
    );
    if (r.kind === "confirmed") {
      const { digest, ...facts } = r.value;
      expect(digest).toBe(snapshotDigest(facts));
    }
  });
  it("refuses unverified receipt/GL even after all current masters pass", async () => {
    const f = setup();
    f.ports.verifyReceipt = async () => ({ kind: "unavailable", code: "n3_journal_incomplete" });
    expect(await loadPreparedSettlementSnapshot(actor, f.ports)).toEqual({
      kind: "unavailable",
      code: "n3_journal_incomplete",
    });
  });
  it("keeps the specific local preparation blocker", async () => {
    const f = setup();
    f.ports.readFacts = async () => ({
      kind: "unavailable",
      code: "settlement_prepared_posting_rows_required",
    });
    expect(await loadPreparedSettlementSnapshot(actor, f.ports)).toEqual({
      kind: "unavailable",
      code: "settlement_prepared_posting_rows_required",
    });
    expect(f.ports.verifyLine).not.toHaveBeenCalled();
  });
  it("rejects a foreign booking receipt before asking N3 for it", async () => {
    const f = setup();
    f.facts.receipts[0].reservationId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    expect((await loadPreparedSettlementSnapshot(actor, f.ports)).kind).not.toBe("confirmed");
    expect(f.ports.verifyReceipt).not.toHaveBeenCalled();
  });
  it("recovers the original frozen bill date on the next property day without repricing", async () => {
    const f = setup();
    const first = await loadPreparedSettlementSnapshot(actor, f.ports);
    if (first.kind !== "confirmed") throw Error("fixture");
    f.facts.folioProjection!.folio.propertyDate = "2026-10-09";
    f.ports.now = () => new Date("2026-10-09T02:00:00Z");
    const r = await loadPreparedSettlementSnapshot(actor, f.ports, first.value);
    expect(r).toEqual(first);
  });
  it("refuses changed local versions for a saved intent", async () => {
    const f = setup();
    const first = await loadPreparedSettlementSnapshot(actor, f.ports);
    if (first.kind !== "confirmed") throw Error("fixture");
    f.facts.sourceVersions[0].version = "2";
    expect(await loadPreparedSettlementSnapshot(actor, f.ports, first.value)).toMatchObject({
      kind: "contradiction",
      code: "settlement_snapshot_changed",
    });
  });
  it("refuses a changed accounting mapping for a saved intent", async () => {
    const f = setup();
    const first = await loadPreparedSettlementSnapshot(actor, f.ports);
    if (first.kind !== "confirmed") throw Error("fixture");
    f.ports.verifyLine = async (_a, l) => ({
      kind: "confirmed",
      value: { ...l, mappingEvidence: { changed: true } },
    });
    expect((await loadPreparedSettlementSnapshot(actor, f.ports, first.value)).kind).not.toBe(
      "confirmed",
    );
  });
  it("does not reuse a foreign tenant's saved snapshot", async () => {
    const f = setup();
    const first = await loadPreparedSettlementSnapshot(actor, f.ports);
    if (first.kind !== "confirmed") throw Error("fixture");
    first.value = structuredClone(first.value);
    first.value.tenantId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    expect((await loadPreparedSettlementSnapshot(actor, f.ports, first.value)).kind).not.toBe(
      "confirmed",
    );
  });
  it("stops when the original caller changes during receipt verification", async () => {
    const f = setup(),
      a = { ...actor };
    f.ports.verifyReceipt = async (_a, _s, r) => {
      a.n3Token = "another-session";
      return { kind: "confirmed", value: r };
    };
    expect((await loadPreparedSettlementSnapshot(a, f.ports)).kind).not.toBe("confirmed");
  });
});
