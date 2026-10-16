import { beforeEach, describe, expect, it, vi } from "vitest";
import { actor, guest, request } from "./fixtures/source-billing";
import { handleSourceBillingHttp, type SourceBillingHttpDeps } from "../source-billing-http.server";
const digest = "d".repeat(64);
function fixture() {
  const value = {
    tenantId: actor.tenantId,
    reservationId: actor.reservationId,
    legacy: false,
    review: null,
    stay: null,
    blockers: ["n3_settlement_master_contract_unverified"],
  };
  const deps: SourceBillingHttpDeps = {
    actor: vi.fn(async () => actor),
    exists: vi.fn(async () => true),
    services: {
      read: vi.fn(async () => value),
      confirm: vi.fn(async () => value),
      step: vi.fn(async () => value),
      reconcile: vi.fn(async () => value),
    },
  };
  return { deps, value };
}
function req(mode: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(
    `https://hotel.test/api/hotel/reservations/${actor.reservationId}/source-billing/${mode}`,
    {
      method: mode === "read" ? "GET" : "POST",
      headers: { "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
}
const input = { expectedFolioRevision: "1", planDigest: digest, clientRequestId: request };
beforeEach(() => vi.restoreAllMocks());
describe("fixed source billing routes", () => {
  it("GET never confirms or posts and strips accidental private response fields", async () => {
    const f = fixture();
    Object.assign(f.value, { n3Token: "NEVER-SERIALIZE", privateProof: {} });
    const r = await handleSourceBillingHttp("read", req("read"), actor.reservationId, f.deps);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.text()).not.toContain("NEVER-SERIALIZE");
    expect(f.deps.services.confirm).not.toHaveBeenCalled();
  });
  it("Front Desk confirm derives its actor and booking solely from server session and route", async () => {
    const f = fixture();
    vi.mocked(f.deps.actor).mockResolvedValue({ ...actor, role: "front_desk", reservationId: "" });
    const r = await handleSourceBillingHttp(
      "confirm",
      req("confirm", input),
      actor.reservationId,
      f.deps,
    );
    expect(r.status).toBe(200);
    expect(f.deps.services.confirm).toHaveBeenCalledWith({ ...actor, role: "front_desk" }, input);
    const forged = await handleSourceBillingHttp(
      "confirm",
      req("confirm", { ...input, n3Token: "owner-token", customerId: 7 }),
      actor.reservationId,
      f.deps,
    );
    expect(forged.status).toBe(400);
  });
  it("denies Housekeeper, missing session and non-existent or malformed booking", async () => {
    const f = fixture();
    vi.mocked(f.deps.actor).mockResolvedValue({ ...actor, role: "housekeeper" });
    expect(
      (await handleSourceBillingHttp("read", req("read"), actor.reservationId, f.deps)).status,
    ).toBe(403);
    vi.mocked(f.deps.actor).mockResolvedValue(null);
    expect(
      (await handleSourceBillingHttp("read", req("read"), actor.reservationId, f.deps)).status,
    ).toBe(401);
    vi.mocked(f.deps.actor).mockResolvedValue(actor);
    vi.mocked(f.deps.exists).mockResolvedValue(false);
    expect(
      (await handleSourceBillingHttp("read", req("read"), actor.reservationId, f.deps)).status,
    ).toBe(404);
    expect((await handleSourceBillingHttp("read", req("read"), "bad", f.deps)).status).toBe(400);
  });
  it("rejects cross-site, wrong method and non-JSON writes before service execution", async () => {
    const f = fixture();
    expect(
      (
        await handleSourceBillingHttp(
          "confirm",
          req("confirm", input, { "sec-fetch-site": "cross-site" }),
          actor.reservationId,
          f.deps,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handleSourceBillingHttp(
          "confirm",
          req("confirm", input, { "content-type": "text/plain" }),
          actor.reservationId,
          f.deps,
        )
      ).status,
    ).toBe(415);
    expect(
      (await handleSourceBillingHttp("confirm", req("read"), actor.reservationId, f.deps)).status,
    ).toBe(405);
    expect(f.deps.services.confirm).not.toHaveBeenCalled();
  });
  it("accepts only the selected leg and matching intent/revisions, never a single-leg close", async () => {
    const f = fixture();
    const step = {
      legId: guest,
      planDigest: digest,
      expectedRevision: "2",
      action: {
        action: "receive_balance",
        intentId: guest,
        expectedRevision: "2",
        paymentLines: [{ accountId: request, amountCents: 4000 }],
      },
    };
    expect(
      (await handleSourceBillingHttp("step", req("step", step), actor.reservationId, f.deps))
        .status,
    ).toBe(200);
    for (const bad of [
      { ...step, action: { ...step.action, intentId: request } },
      { ...step, action: { ...step.action, expectedRevision: "3" } },
      { ...step, action: { action: "close", intentId: guest, expectedRevision: "2" } },
      { ...step, plan: {} },
    ])
      expect(
        (await handleSourceBillingHttp("step", req("step", bad), actor.reservationId, f.deps))
          .status,
      ).toBe(400);
    expect(f.deps.services.step).toHaveBeenCalledTimes(1);
  });
  it("maps stale reviewed facts to conflict and N3 expiry to 401 without exposing errors", async () => {
    const f = fixture();
    vi.mocked(f.deps.services.confirm).mockRejectedValue(Error("settlement_snapshot_changed"));
    expect(
      (await handleSourceBillingHttp("confirm", req("confirm", input), actor.reservationId, f.deps))
        .status,
    ).toBe(409);
    f.value.blockers = ["n3_session_expired"];
    expect(
      (await handleSourceBillingHttp("read", req("read"), actor.reservationId, f.deps)).status,
    ).toBe(401);
    vi.mocked(f.deps.services.read).mockRejectedValue(Error("secret database details"));
    const r = await handleSourceBillingHttp("read", req("read"), actor.reservationId, f.deps);
    expect(r.status).toBe(503);
    expect(await r.text()).not.toContain("secret");
  });
  it("rejects a foreign or malformed response instead of releasing money or credentials", async () => {
    const f = fixture();
    f.value.tenantId = request;
    expect(
      (await handleSourceBillingHttp("read", req("read"), actor.reservationId, f.deps)).status,
    ).toBe(503);
    f.value.tenantId = actor.tenantId;
    f.value.blockers = null as never;
    expect(
      (await handleSourceBillingHttp("read", req("read"), actor.reservationId, f.deps)).status,
    ).toBe(503);
  });
});

it("denies a session switch after booking lookup before any service call", async () => {
  const f = fixture();
  vi.mocked(f.deps.exists).mockImplementation(async () => {
    vi.mocked(f.deps.actor).mockResolvedValue({ ...actor, n3Token: "changed" });
    return true;
  });
  const r = await handleSourceBillingHttp(
    "confirm",
    req("confirm", input),
    actor.reservationId,
    f.deps,
  );
  expect(r.status).toBe(401);
  expect(f.deps.services.confirm).not.toHaveBeenCalled();
});
it("does not return a prior-session financial view after a service await", async () => {
  const f = fixture();
  vi.mocked(f.deps.services.read).mockImplementation(async () => {
    vi.mocked(f.deps.actor).mockResolvedValue(null);
    return f.value;
  });
  const r = await handleSourceBillingHttp("read", req("read"), actor.reservationId, f.deps);
  expect(r.status).toBe(401);
});
