import { describe, expect, it, vi } from "vitest";
import { handleSourcePolicyHttp, type SourcePolicyHttpDeps } from "../source-policy-http.server";
import { actor, plan } from "./fixtures/source-billing";
const policy = plan().payer.policy,
  id = actor.reservationId;
function setup() {
  const facts = {
    tenantId: actor.tenantId,
    reservationId: id,
    sourceId: policy.sourceId,
    revision: "0",
    updatedAt: "2026-10-15T02:00:00Z",
    frozen: false,
    payer: null,
  };
  const saved = {
    ...facts,
    revision: "1",
    payer: {
      policy,
      collectionMode: "source" as const,
      confirmedBy: actor.n3UserKey,
      confirmedAt: "2026-10-15T02:01:00Z",
    },
  };
  const deps: SourcePolicyHttpDeps = {
    actor: vi.fn(async () => ({ ...actor, reservationId: "" })),
    exists: vi.fn(async () => true),
    store: {
      readSettings: vi.fn(async () => ({
        kind: "confirmed" as const,
        value: { policy, blockers: [] },
      })),
      readReservation: vi.fn(async () => ({ kind: "confirmed" as const, value: facts })),
      readPolicy: vi.fn(async () => ({ kind: "confirmed" as const, value: policy })),
      update: vi.fn(async () => ({
        kind: "confirmed" as const,
        value: { ...policy, version: "2" },
      })),
      confirm: vi.fn(async () => ({ kind: "confirmed" as const, value: saved })),
    },
  };
  return { deps, facts, saved };
}
function req(method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  return new Request("https://hotel.test/api/hotel/test", {
    method,
    headers: { "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const reviewed = {
  expectedSourceId: policy.sourceId,
  expectedPolicyVersion: policy.version,
  expectedReservationUpdatedAt: "2026-10-15T02:00:00Z",
};
describe("scoped source policy and saved payer endpoints", () => {
  it("requires the complete Owner-reviewed preconditions before saving", async () => {
    const f = setup();
    const r = await handleSourcePolicyHttp(
      "payer_save",
      req("POST", { collectionMode: "source", expectedRevision: "0" }),
      id,
      f.deps,
    );
    expect(r.status).toBe(400);
    expect(f.deps.store.confirm).not.toHaveBeenCalled();
  });
  it("accepts established 160/600 document text on read and write without reporting failure after save", async () => {
    const f = setup(),
      long = {
        ...policy,
        guestDocumentTitle: "T".repeat(160),
        guestItemDescription: "D".repeat(600),
      };
    vi.mocked(f.deps.store.readPolicy).mockResolvedValue({ kind: "confirmed", value: long });
    Object.assign(f.deps.store, {
      readSettings: vi.fn(async () => ({
        kind: "confirmed",
        value: { policy: long, blockers: [] },
      })),
    });
    vi.mocked(f.deps.store.update).mockResolvedValue({
      kind: "confirmed",
      value: { ...long, version: "2" },
    });
    expect(
      (await handleSourcePolicyHttp("policy_read", req(), policy.sourceId, f.deps)).status,
    ).toBe(200);
    const saved = await handleSourcePolicyHttp(
      "policy_save",
      req("POST", { expectedVersion: "1", policy: long }),
      policy.sourceId,
      f.deps,
    );
    expect(saved.status).toBe(200);
    expect(f.deps.store.update).toHaveBeenCalledTimes(1);
    Object.assign(f.facts, { payer: { ...f.saved.payer, policy: long }, frozen: true });
    expect((await handleSourcePolicyHttp("payer_read", req(), id, f.deps)).status).toBe(200);
  });
  it("returns repairable Owner configuration with separate customer-verification blockers", async () => {
    const f = setup();
    vi.mocked(f.deps.store.readPolicy).mockResolvedValue({
      kind: "contradiction",
      code: "master_customer_inactive",
    });
    Object.assign(f.deps.store, {
      readSettings: vi.fn(async () => ({
        kind: "confirmed",
        value: { policy, blockers: ["master_customer_inactive"] },
      })),
    });
    const r = await handleSourcePolicyHttp("policy_read", req(), policy.sourceId, f.deps);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ policy, blockers: ["master_customer_inactive"] });
  });
  it("reads a payer review without saving and strips accidental server-only fields", async () => {
    const f = setup();
    Object.assign(f.facts, { n3Token: "PRIVATE", rawJournal: { secret: "PRIVATE" } });
    const r = await handleSourcePolicyHttp("payer_read", req(), id, f.deps);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const text = await r.text();
    expect(text).not.toContain("PRIVATE");
    expect(JSON.parse(text)).toMatchObject({
      reservationId: id,
      revision: "0",
      policy,
      payer: null,
    });
    expect(f.deps.store.confirm).not.toHaveBeenCalled();
    expect(f.deps.store.update).not.toHaveBeenCalled();
  });
  it("saves only the explicit collection mode and expected payer revision for an Owner", async () => {
    const f = setup(),
      r = await handleSourcePolicyHttp(
        "payer_save",
        req("POST", { collectionMode: "source", expectedRevision: "0", ...reviewed }),
        id,
        f.deps,
      );
    expect(r.status).toBe(200);
    expect(f.deps.store.confirm).toHaveBeenCalledWith(actor, "source", "0", {
      sourceId: policy.sourceId,
      policyVersion: policy.version,
      reservationUpdatedAt: reviewed.expectedReservationUpdatedAt,
    });
    expect(await r.json()).toMatchObject({ revision: "1", payer: { collectionMode: "source" } });
  });
  it("Front Desk reads the saved payer but cannot override it", async () => {
    const f = setup();
    vi.mocked(f.deps.actor).mockResolvedValue({ ...actor, role: "front_desk", reservationId: "" });
    expect((await handleSourcePolicyHttp("payer_read", req(), id, f.deps)).status).toBe(200);
    expect(
      (
        await handleSourcePolicyHttp(
          "payer_save",
          req("POST", { collectionMode: "guest", expectedRevision: "0", ...reviewed }),
          id,
          f.deps,
        )
      ).status,
    ).toBe(403);
    expect(f.deps.store.confirm).not.toHaveBeenCalled();
  });
  it("reads source settings with no invented reservation ID", async () => {
    const f = setup();
    expect(
      (await handleSourcePolicyHttp("policy_read", req(), policy.sourceId, f.deps)).status,
    ).toBe(200);
    expect(f.deps.store.readSettings).toHaveBeenCalledWith(
      { ...actor, reservationId: "" },
      policy.sourceId,
    );
  });
  it("Owner saves the exact versioned source policy", async () => {
    const f = setup();
    const r = await handleSourcePolicyHttp(
      "policy_save",
      req("POST", { expectedVersion: "1", policy }),
      policy.sourceId,
      f.deps,
    );
    expect(r.status).toBe(200);
    expect(f.deps.store.update).toHaveBeenCalledWith(
      { ...actor, reservationId: "" },
      { sourceId: policy.sourceId, expectedVersion: "1", policy },
    );
  });
  it.each(["payer_save", "policy_save"] as const)(
    "rejects caller-selected credentials and tenant in %s",
    async (mode) => {
      const f = setup();
      expect(
        (
          await handleSourcePolicyHttp(
            mode,
            req("POST", {
              collectionMode: "guest",
              expectedRevision: "0",
              n3Token: "forged",
              tenantId: actor.tenantId,
            }),
            id,
            f.deps,
          )
        ).status,
      ).toBe(400);
      expect(f.deps.store.confirm).not.toHaveBeenCalled();
      expect(f.deps.store.update).not.toHaveBeenCalled();
    },
  );
  it.each(["null", "garbage", "https://foreign.test"])(
    "denies malformed/foreign origin %s before service access",
    async (origin) => {
      const f = setup();
      expect(
        (await handleSourcePolicyHttp("payer_save", req("POST", {}, { origin }), id, f.deps))
          .status,
      ).toBe(403);
      expect(f.deps.actor).not.toHaveBeenCalled();
    },
  );
  it("denies housekeeper and foreign bookings before policy/current-master reads", async () => {
    const f = setup();
    vi.mocked(f.deps.actor).mockResolvedValue({ ...actor, role: "housekeeper" });
    expect((await handleSourcePolicyHttp("payer_read", req(), id, f.deps)).status).toBe(403);
    vi.mocked(f.deps.actor).mockResolvedValue(actor);
    vi.mocked(f.deps.exists).mockResolvedValue(false);
    expect((await handleSourcePolicyHttp("payer_read", req(), id, f.deps)).status).toBe(404);
    expect(f.deps.store.readReservation).not.toHaveBeenCalled();
  });
  it("returns stale revision as 409 without displaying old success", async () => {
    const f = setup();
    vi.mocked(f.deps.store.confirm).mockResolvedValue({
      kind: "contradiction",
      code: "source_payer_revision_conflict",
    });
    const r = await handleSourcePolicyHttp(
      "payer_save",
      req("POST", { collectionMode: "guest", expectedRevision: "0", ...reviewed }),
      id,
      f.deps,
    );
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "source_payer_revision_conflict" });
  });
  it("refuses a foreign reservation returned by a service", async () => {
    const f = setup();
    f.facts.reservationId = "88888888-8888-4888-8888-888888888888";
    expect((await handleSourcePolicyHttp("payer_read", req(), id, f.deps)).status).toBe(503);
  });
  it("keeps a saved payer visible when current policy verification is unavailable", async () => {
    const f = setup();
    Object.assign(f.facts, { payer: f.saved.payer });
    vi.mocked(f.deps.store.readPolicy).mockResolvedValue({
      kind: "unavailable",
      code: "n3_master_read_unavailable",
    });
    const r = await handleSourcePolicyHttp("payer_read", req(), id, f.deps);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      payer: f.saved.payer,
      policy: null,
      blockers: ["n3_master_read_unavailable"],
    });
  });
  it("requires authentication and clears N3-expired evidence", async () => {
    const f = setup();
    vi.mocked(f.deps.actor).mockResolvedValue(null);
    expect((await handleSourcePolicyHttp("policy_read", req(), id, f.deps)).status).toBe(401);
    vi.mocked(f.deps.actor).mockResolvedValue(actor);
    vi.mocked(f.deps.store.readSettings).mockResolvedValue({
      kind: "unavailable",
      code: "n3_session_expired",
    });
    expect((await handleSourcePolicyHttp("policy_read", req(), id, f.deps)).status).toBe(401);
  });
});
