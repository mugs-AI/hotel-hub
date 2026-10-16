vi.mock("@/lib/hotel-store.server", () => ({
  getHotelSettingsReadOnly: async () => ({ housekeepingMode: "dedicated" }),
}));
import { beforeEach, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({
  ctx: {
    session: { tenantId: "22222222-2222-4222-8222-222222222222", n3UserKey: "staff" },
    role: "front_desk",
  },
  allow: true,
  rpc: vi.fn(),
}));
vi.mock("@/lib/session-context.server", () => ({
  requirePermission: async () => ({
    ctx: io.ctx,
    decision: io.allow ? { ok: true } : { ok: false, reason: "forbidden" },
  }),
}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc: io.rpc } }));
import {
  handleSecurityReservationGet,
  handleSecurityReservationPost,
} from "@/routes/api/hotel/reservations.$id.security-cash";
const id = "44444444-4444-4444-8444-444444444444";
const body = {
  key: "33333333-3333-4333-8333-333333333333",
  command: {
    action: "collect",
    roomStayId: "55555555-5555-4555-8555-555555555555",
    payer: "Guest",
    recipient: "Guest",
    storage: "Envelope",
    method: "cash",
    policyVersion: "0",
  },
};
const request = (
  b: unknown = body,
  identity = "22222222-2222-4222-8222-222222222222:staff:front_desk",
  origin = "https://hotel.test",
) =>
  new Request("https://hotel.test/api/hotel/reservations/" + id + "/security-cash", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      "x-hotelhub-expected-identity": identity,
    },
    body: JSON.stringify(b),
  });
beforeEach(() => {
  vi.clearAllMocks();
  io.allow = true;
  io.ctx.role = "front_desk";
  io.rpc.mockResolvedValue({ data: { id: "local", heldCents: 5000 }, error: null });
});
it("uses trusted tenant and staff for local collection", async () => {
  const r = await handleSecurityReservationPost({ request: request(), params: { id } });
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({ heldCents: 5000 });
  expect(io.rpc).toHaveBeenCalledWith(
    "hh_security_command",
    expect.objectContaining({
      p_tenant: "22222222-2222-4222-8222-222222222222",
      p_actor: "staff",
      p_role: "front_desk",
      p_reservation: id,
    }),
  );
});
it("denies changed identity and cross-origin before storage", async () => {
  expect(
    (await handleSecurityReservationPost({ request: request(body, "other"), params: { id } }))
      .status,
  ).toBe(409);
  expect(
    (
      await handleSecurityReservationPost({
        request: request(body, undefined, "https://evil.test"),
        params: { id },
      })
    ).status,
  ).toBe(403);
  expect(io.rpc).not.toHaveBeenCalled();
});
it("denies role or injected context", async () => {
  io.allow = false;
  expect((await handleSecurityReservationGet({ params: { id } })).status).toBe(403);
  io.allow = true;
  expect(
    (
      await handleSecurityReservationPost({
        request: request({ ...body, tenantId: "evil" }),
        params: { id },
      })
    ).status,
  ).toBe(400);
  expect(io.rpc).not.toHaveBeenCalled();
});
it("does not turn missing schema or private DB errors into zero cash", async () => {
  for (const error of [
    { code: "PGRST202", message: "private database text" },
    { message: "private SQL" },
  ]) {
    io.rpc.mockResolvedValue({ data: null, error });
    const r = await handleSecurityReservationGet({ params: { id } });
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "security_unavailable" });
  }
});
it("gives housekeeping inspection facts without any cash fields", async () => {
  io.ctx.role = "housekeeper";
  io.rpc.mockResolvedValue({
    data: {
      holdings: [
        {
          id: "local",
          version: "v",
          roomNumber: "101",
          hotelRoomId: "room",
          inspectionClear: false,
        },
      ],
    },
    error: null,
  });
  const r = await handleSecurityReservationGet({
    params: { id },
    request: new Request(
      "https://hotel.test/api/hotel/reservations/" + id + "/security-cash?mode=inspection",
    ),
  });
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({
    holdings: [
      { id: "local", version: "v", roomNumber: "101", hotelRoomId: "room", inspectionClear: false },
    ],
  });
});
it("Front Desk count POST cannot obtain Owner snapshot events or guest information", async () => {
  const { writeSecurityStatement } = await import("../security-cash.server");
  io.rpc.mockResolvedValue({
    data: {
      id: "s",
      version: "v",
      counts: [],
      snapshot: {
        holdings: [
          {
            payer: "Private guest",
            recipient: "Private recipient",
            terms: "Private notes",
            id: "h",
          },
        ],
        events: [{ detail: { reason: "Owner private dispute" } }],
      },
    },
    error: null,
  });
  const result = await writeSecurityStatement(
    { tenantId: io.ctx.session.tenantId, userKey: "staff", role: "front_desk" },
    "33333333-3333-4333-8333-333333333333",
    {
      action: "count",
      from: "2026-01-01T00:00:00Z",
      counts: [],
      singlePerson: true,
      note: "Count",
      storage: "Safe",
    },
  );
  expect(result.snapshot.events).toEqual([]);
  expect(result.snapshot.holdings[0].payer).toBe("");
  expect(result.snapshot.holdings[0].recipient).toBe("");
});
