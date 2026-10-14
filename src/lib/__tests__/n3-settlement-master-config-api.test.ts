import { describe, expect, it, vi } from "vitest";
import {
  handleConfiguredMasterIds,
  type ConfiguredMasterDeps,
} from "../n3-settlement-master-config.http.server";
const actor = {
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  n3UserKey: "owner",
  n3Token: "private-token",
  role: "owner" as const,
};
const result = {
  schemaVersion: "hh-configured-master-ids-v1" as const,
  contractAccepted: false as const,
  masters: [{ kind: "customer" as const, id: 71 }],
  missingKinds: [],
  invalidReferenceCount: 0,
};
function deps(): ConfiguredMasterDeps {
  return { actor: async () => actor, load: vi.fn(async () => result) };
}
function request(query = "", origin = "https://hh.example.test", method = "GET") {
  return new Request("https://hh.example.test/api/n3/settlement-master-capture" + query, {
    method,
    headers: { origin },
  });
}
describe("Owner saved billing references HTTP", () => {
  it("loads only the server session's tenant and sends no credential or names", async () => {
    const d = deps();
    const response = await handleConfiguredMasterIds(request(), d);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ configured: result });
    expect(d.load).toHaveBeenCalledWith(actor.tenantId);
  });
  it.each(["front_desk", "housekeeper"] as const)(
    "denies %s before database access",
    async (role) => {
      const d = deps();
      d.actor = async () => ({ ...actor, role });
      expect((await handleConfiguredMasterIds(request(), d)).status).toBe(403);
      expect(d.load).not.toHaveBeenCalled();
    },
  );
  it("denies an ended session", async () => {
    const d = deps();
    d.actor = async () => null;
    expect((await handleConfiguredMasterIds(request(), d)).status).toBe(401);
    expect(d.load).not.toHaveBeenCalled();
  });
  it.each(["?tenantId=alien", "?reservationId=foreign", "?url=https://other.test"])(
    "refuses browser-selected authority %s",
    async (query) => {
      const d = deps();
      expect((await handleConfiguredMasterIds(request(query), d)).status).toBe(400);
      expect(d.load).not.toHaveBeenCalled();
    },
  );
  it("denies cross-origin reads", async () => {
    const d = deps();
    expect((await handleConfiguredMasterIds(request("", "https://alien.test"), d)).status).toBe(
      403,
    );
    expect(d.load).not.toHaveBeenCalled();
  });
  it("returns only a stable error on database failure", async () => {
    const d = deps();
    d.load = async () => {
      throw Error("credential/db-error-detail");
    };
    const r = await handleConfiguredMasterIds(request(), d);
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "configured_master_read_unavailable" });
  });
  it("rejects writes on the saved-ID reader", async () => {
    const d = deps();
    expect((await handleConfiguredMasterIds(request("", undefined, "POST"), d)).status).toBe(405);
    expect(d.load).not.toHaveBeenCalled();
  });
});
