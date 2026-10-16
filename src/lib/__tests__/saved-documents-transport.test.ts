import { afterEach, describe, expect, it, vi } from "vitest";
import { n3BillingClient } from "../n3-billing.server";
import { fixtureActor as actor, fixtureBillId as billId } from "./fixtures/settlement-evidence";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("shared fixed-reader transport budget", () => {
  it("all_response_bytes_share_one_cap", async () => {
    const limit = {
      deadlineAt: Date.now() + 10000,
      signal: new AbortController().signal,
      budget: { remainingBytes: 80 },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ code: "0000", data: { note: "123456789012345678901234567890" } }),
      ),
    );
    expect((await n3BillingClient.readBill(actor, billId, limit)).kind).toBe("response");
    const second = await n3BillingClient.readBillJournal(actor, billId, limit);
    expect(second).toMatchObject({ kind: "transport_error", reason: "too_large" });
    expect(limit.budget.remainingBytes).toBeGreaterThanOrEqual(0);
  });
  it("already_aborted_or_expired_read_has_no_fetch", async () => {
    const c = new AbortController();
    c.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ code: "0000", data: [] })),
    );
    await n3BillingClient.readBill(actor, billId, {
      deadlineAt: Date.now() + 1000,
      signal: c.signal,
      budget: { remainingBytes: 100 },
    });
    await n3BillingClient.readBill(actor, billId, {
      deadlineAt: Date.now() - 1,
      signal: new AbortController().signal,
      budget: { remainingBytes: 100 },
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
