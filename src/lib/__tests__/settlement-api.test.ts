import { describe, it, expect, vi } from "vitest";
import { handleSettlementHttp, type SettlementHttpDeps } from "../settlement-http.server";
import { fixtureActor as actor } from "./fixtures/settlement-evidence";
import type { SettlementView } from "../settlement";
const id = actor.reservationId,
  intentId = "44444444-4444-4444-8444-444444444444";
const view: SettlementView = {
  tenantId: actor.tenantId,
  reservationId: id,
  intentId,
  snapshotDigest: "d".repeat(64),
  revision: "2",
  state: "needs_review",
  currency: "MYR",
  bill: null,
  receipts: [],
  blockers: [],
  allowedActions: [],
  verifiedAt: null,
};
function setup(role: typeof actor.role = "owner") {
  const services = {
    read: vi.fn(async () => view),
    step: vi.fn(async () => view),
    reconcile: vi.fn(async () => view),
  };
  const deps: SettlementHttpDeps = {
    actor: async () => ({ ...actor, role }),
    exists: vi.fn(async () => true),
    services,
  };
  return { deps, services };
}
const request = (body: unknown) =>
  new Request("https://synthetic.test", { method: "POST", body: JSON.stringify(body) });
describe("scoped settlement HTTP", () => {
  it("Front Desk GET is read-only/no-store and POST is403", async () => {
    const f = setup("front_desk");
    const r = await handleSettlementHttp("read", new Request("https://synthetic.test"), id, f.deps);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(
      (
        await handleSettlementHttp(
          "step",
          request({ action: "close", intentId, expectedRevision: "2" }),
          id,
          f.deps,
        )
      ).status,
    ).toBe(403);
    expect(f.services.step).not.toHaveBeenCalled();
    expect(f.services.reconcile).not.toHaveBeenCalled();
  });
  it("housekeeper cannot read or reconcile money", async () => {
    const f = setup("housekeeper");
    expect(
      (await handleSettlementHttp("read", new Request("https://synthetic.test"), id, f.deps))
        .status,
    ).toBe(403);
    expect(
      (await handleSettlementHttp("reconcile", request({ intentId }), id, f.deps)).status,
    ).toBe(403);
    expect(f.services.read).not.toHaveBeenCalled();
  });
  it("alien or absent reservation returns404 before service", async () => {
    const f = setup();
    f.deps.exists = vi.fn(async () => false);
    expect(
      (await handleSettlementHttp("read", new Request("https://synthetic.test"), id, f.deps))
        .status,
    ).toBe(404);
    expect(f.services.read).not.toHaveBeenCalled();
  });
  it.each(["tenantId", "n3Token", "amountCents", "role", "url", "unknown"])(
    "rejects browser %s",
    async (key) => {
      const f = setup();
      expect(
        (
          await handleSettlementHttp(
            "step",
            request({
              action: "receive_balance",
              intentId,
              expectedRevision: "2",
              [key]: "injected",
            }),
            id,
            f.deps,
          )
        ).status,
      ).toBe(400);
      expect(f.services.step).not.toHaveBeenCalled();
    },
  );
  it("expired session returns401 without stale money", async () => {
    const f = setup();
    f.services.read.mockResolvedValue({
      ...view,
      bill: {
        id: intentId,
        code: "CS-SYNTHETIC",
        documentDate: "2026-10-08",
        totalCents: 50000,
        outstandingCents: 45000,
      },
      blockers: ["n3_session_expired"],
    });
    const r = await handleSettlementHttp("read", new Request("https://synthetic.test"), id, f.deps);
    expect(r.status).toBe(401);
    expect(await r.text()).not.toContain("50000");
  });
  it("missing SQL produces explicit unavailable status and no fallback writer", async () => {
    const f = setup();
    f.services.read.mockResolvedValue({ ...view, blockers: ["settlement_setup_required"] });
    const r = await handleSettlementHttp("read", new Request("https://synthetic.test"), id, f.deps);
    expect(r.status).toBe(200);
    expect((await r.json()).blockers).toEqual(["settlement_setup_required"]);
    expect(f.services.step).not.toHaveBeenCalled();
  });
  it("reconcile returns the same persisted attempt using server actor scope", async () => {
    const f = setup();
    const r = await handleSettlementHttp("reconcile", request({ intentId }), id, f.deps);
    expect((await r.json()).intentId).toBe(intentId);
    expect(f.services.reconcile).toHaveBeenCalledWith(actor, intentId);
  });
  it.each([
    { action: "close", intentId, expectedRevision: 2 },
    { action: "receive_balance", intentId, expectedRevision: "02" },
    { action: "close", intentId, expectedRevision: "2", selectedAccountId: intentId },
    {
      action: "post_bill",
      clientRequestId: intentId,
      snapshotDigest: "d".repeat(64),
      expectedRevision: "0",
      receiptId: intentId,
    },
  ])("rejects malformed or extraneous action fields", async (body) => {
    const f = setup();
    expect((await handleSettlementHttp("step", request(body), id, f.deps)).status).toBe(400);
  });
});

it("apply_balance accepts saved receipt application and rejects a new selected account", async () => {
  const f = setup();
  const input = { action: "apply_balance", intentId, expectedRevision: "2" };
  expect((await handleSettlementHttp("step", request(input), id, f.deps)).status).toBe(200);
  expect(f.services.step).toHaveBeenCalledWith(actor, input);
  expect(
    (
      await handleSettlementHttp(
        "step",
        request({ ...input, selectedAccountId: "11111111-1111-4111-8111-111111111111" }),
        id,
        f.deps,
      )
    ).status,
  ).toBe(400);
});
