import { captureSettlementMasters } from "../n3-settlement-master-diagnostics.server";
import { describe, expect, it, vi } from "vitest";
import {
  handleMasterCapture,
  type MasterCaptureDeps,
} from "../n3-settlement-master-diagnostics.http.server";
const actor = {
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  reservationId: "",
  n3UserKey: "fixture-owner",
  n3Token: "fixture-private-token",
  role: "owner" as const,
};
function deps(): MasterCaptureDeps {
  return {
    actor: async () => actor,
    capture: vi.fn(async () => ({
      schemaVersion: "hh-master-capture-v1" as const,
      capturedAt: "2026-10-14T01:00:00Z",
      status: "captured" as const,
      contractAccepted: false as const,
      evidence: [],
    })),
    endSession: vi.fn(async () => {}),
  };
}
const body = { masters: [{ kind: "customer", id: 71 }] };
function request(data: unknown = body, origin = "https://hh.example.test") {
  return new Request("https://hh.example.test/api/n3/settlement-master-capture", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(data),
  });
}
describe("master capture HTTP", () => {
  it("uses only the authenticated Owner identity", async () => {
    const d = deps();
    expect((await handleMasterCapture(request(), d)).status).toBe(200);
    expect(d.capture).toHaveBeenCalledWith(actor, body);
    expect(d.endSession).not.toHaveBeenCalled();
  });
  it("refuses a missing session", async () => {
    const d = deps();
    d.actor = async () => null;
    expect((await handleMasterCapture(request(), d)).status).toBe(401);
    expect(d.capture).not.toHaveBeenCalled();
  });
  it("refuses staff even with a valid own N3 token", async () => {
    const d = deps();
    d.actor = async () => ({ ...actor, role: "front_desk" });
    expect((await handleMasterCapture(request(), d)).status).toBe(403);
    expect(d.capture).not.toHaveBeenCalled();
  });
  it.each([
    { ...body, token: "foreign" },
    { ...body, tenantId: "alien" },
    { ...body, url: "https://other.test" },
    { masters: [{ kind: "stock", id: "../1" }] },
  ])("rejects browser authority %j", async (data) => {
    const d = deps();
    expect((await handleMasterCapture(request(data), d)).status).toBe(400);
    expect(d.capture).not.toHaveBeenCalled();
  });
  it("refuses cross-origin calls before capture", async () => {
    const d = deps();
    expect((await handleMasterCapture(request(body, "https://alien.example.test"), d)).status).toBe(
      403,
    );
    expect(d.capture).not.toHaveBeenCalled();
  });
  it("ends the session and returns no diagnostic sample after an N3 401", async () => {
    const d = deps();
    d.capture = async () => ({
      schemaVersion: "hh-master-capture-v1",
      capturedAt: "2026-10-14T01:00:00Z",
      status: "unauthorized",
      contractAccepted: false,
      evidence: [],
    });
    const response = await handleMasterCapture(request(), d);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "n3_unauthorized" });
    expect(d.endSession).toHaveBeenCalledTimes(1);
  });
  it.each(["reject", "hang"])(
    "ends the session when 401 body cleanup %s",
    async (mode) => {
      const fetcher = vi.fn(async () => {
        const response = new Response(null, { status: 401 });
        Object.defineProperty(response, "body", {
          value: {
            cancel: () =>
              mode === "reject" ? Promise.reject(Error("body failed")) : new Promise(() => {}),
          },
        });
        return response;
      });
      const d = deps();
      d.capture = (a, input) =>
        captureSettlementMasters(
          a,
          { masters: [...input.masters, { kind: "stock", id: 101 }] },
          { fetcher },
        );
      const response = await handleMasterCapture(request(), d);
      expect(response.status).toBe(401);
      expect(d.endSession).toHaveBeenCalledTimes(1);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
    15000,
  );
});
