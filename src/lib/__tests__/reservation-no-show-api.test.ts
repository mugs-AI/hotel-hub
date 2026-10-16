import { describe, expect, it, vi } from "vitest";
import { handleNoShowHttp, type NoShowHttpDeps } from "../reservation-no-show.http.server";
const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const actor = {
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  n3UserKey: "fixture-staff",
  role: "front_desk" as const,
};
const body = {
  clientRequestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  expectedUpdatedAt: "2026-10-13T00:00:00.123456Z",
  reason: "Guest did not arrive",
};
function request(input: unknown = body, origin = "https://hh.example.test") {
  return new Request("https://hh.example.test/api/hotel/reservations/" + id + "/no-show", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}
function deps(): NoShowHttpDeps {
  return {
    actor: async () => actor,
    read: async () => ({
      eligible: true,
      propertyDate: "2026-10-14",
      updatedAt: body.expectedUpdatedAt,
    }),
    mark: vi.fn(async () => ({
      reservationId: id,
      status: "no_show" as const,
      updatedAt: "2026-10-14T01:00:00Z",
      releasedRoomIds: [],
      accountingReviewRequired: false,
    })),
  };
}
describe("no-show fixed same-origin HTTP", () => {
  it("permits Front Desk using trusted identity and path", async () => {
    const d = deps();
    const response = await handleNoShowHttp("mark", request(), id, d);
    expect(response.status).toBe(200);
    expect(d.mark).toHaveBeenCalledWith(actor, { ...body, reservationId: id });
  });
  it("read does no mutation", async () => {
    const d = deps();
    expect(
      (await handleNoShowHttp("read", new Request("https://hh.example.test"), id, d)).status,
    ).toBe(200);
    expect(d.mark).not.toHaveBeenCalled();
  });
  it.each(["https://alien.example.test", ""])("refuses origin %s", async (origin) => {
    const d = deps();
    expect((await handleNoShowHttp("mark", request(body, origin), id, d)).status).toBe(403);
    expect(d.mark).not.toHaveBeenCalled();
  });
  it.each([
    { tenantId: "alien" },
    { reservationId: "alien" },
    { role: "owner" },
    { releasedRoomIds: [] },
  ])("refuses browser authority %j", async (patch) => {
    const d = deps();
    expect((await handleNoShowHttp("mark", request({ ...body, ...patch }), id, d)).status).toBe(
      400,
    );
    expect(d.mark).not.toHaveBeenCalled();
  });
  it("rejects Housekeeper and ended session", async () => {
    const d = deps();
    d.actor = async () => ({ ...actor, role: "housekeeper" });
    expect((await handleNoShowHttp("mark", request(), id, d)).status).toBe(403);
    d.actor = async () => null;
    expect((await handleNoShowHttp("mark", request(), id, d)).status).toBe(401);
    expect(d.mark).not.toHaveBeenCalled();
  });
});
