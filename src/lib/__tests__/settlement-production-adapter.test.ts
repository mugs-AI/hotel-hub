import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readLinkedReceiptDate,
  loadLivePreparedSettlementSnapshot,
} from "../settlement-production-adapter.server";
import { fixtureActor as actor } from "./fixtures/settlement-evidence";
import { n3BillingClient } from "../n3-billing.server";
import { settlementFixture } from "./fixtures/settlement";
const receiptId = settlementFixture().receipts[0].receiptId;
const db = vi.hoisted(() => ({
  rpc: vi.fn(async () => ({ data: null, error: { code: "42883" } })),
  from: vi.fn(() => {
    throw Error("unexpected query");
  }),
}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: db }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  db.rpc.mockClear();
  db.from.mockClear();
});
async function read(data: unknown, a = actor) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ code: "0000", data }), { status: 200 })),
  );
  return n3BillingClient.readReceipt(a, receiptId);
}
describe("live prepared facts adapter boundaries", () => {
  it("fails as setup-required before any N3 read or write when the billing schema is absent", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(await loadLivePreparedSettlementSnapshot(actor)).toEqual({
      kind: "unavailable",
      code: "settlement_setup_required",
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalled();
  });
  it("uses the exact saved receipt's own authenticated document date", async () => {
    const out = await read({ id: receiptId, docDate: "2026-09-30T00:00:00" });
    expect(readLinkedReceiptDate(actor, receiptId, out)).toEqual({
      kind: "confirmed",
      value: "2026-09-30",
    });
  });
  it("rejects a raw response copied from an export instead of a bound own-session read", async () => {
    expect(
      readLinkedReceiptDate(actor, receiptId, {
        kind: "response",
        status: 200,
        body: { code: "0000", data: { id: receiptId, docDate: "2026-09-30" } },
        durationMs: 0,
      }).kind,
    ).not.toBe("confirmed");
  });
  it("rejects another actor's authenticated response", async () => {
    const out = await read(
      { id: receiptId, docDate: "2026-09-30" },
      { ...actor, n3UserKey: "other", n3Token: "other" },
    );
    expect(readLinkedReceiptDate(actor, receiptId, out).kind).not.toBe("confirmed");
  });
  it.each(["2026-02-30", "not-a-date", "2026-09-30garbage"])(
    "does not truncate an invalid document date %s into a valid date",
    async (docDate) => {
      expect(
        readLinkedReceiptDate(actor, receiptId, await read({ id: receiptId, docDate })).kind,
      ).not.toBe("confirmed");
    },
  );
  it("rejects a mismatching document ID even when the requested customer is shared", async () => {
    expect(
      readLinkedReceiptDate(
        actor,
        receiptId,
        await read({ id: actor.reservationId, docDate: "2026-09-30" }),
      ).kind,
    ).not.toBe("confirmed");
  });
});
