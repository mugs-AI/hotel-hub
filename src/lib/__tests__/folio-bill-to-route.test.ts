import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  installed: false,
  policyError: false,
  allowed: true,
  exists: true,
  rows: [] as Record<string, unknown>[],
  filters: [] as Array<[string, unknown]>,
}));
vi.mock("@/lib/hotel-change-controls-store.server", () => ({
  readChangePolicy: async () => {
    if (state.policyError) throw new Error("read failed");
    return state.installed
      ? { revision: "0", depositApprovalRequired: true, contactApprovalRequired: true }
      : null;
  },
}));
vi.mock("@/lib/folio-api.server", () => ({
  requireFolioActor: async () =>
    state.allowed
      ? { actor: { tenantId: "tenant-A", actorKey: "actor-A" } }
      : { response: Response.json({ error: "forbidden" }, { status: 403 }) },
  folioDeny: (status: number, error: string) => Response.json({ error }, { status }),
  folioJson: (value: unknown) => Response.json(value),
  folioSameOriginGuard: (request: Request) =>
    request.headers.get("origin") === "https://hotel.example"
      ? null
      : Response.json({ error: "forbidden" }, { status: 403 }),
}));
vi.mock("@/lib/reservations-store.server", () => ({
  isUuid: (value: string) => /^[a-f\d-]{36}$/.test(value),
  getReservationById: async (_tenantId: string, id: string) =>
    state.exists
      ? {
          id,
          status: "checked_in",
          guests: [
            {
              isPrimary: true,
              fullName: "Guest",
              mobile: "123",
              email: "guest@example.com",
              addressLine1: "Street",
              addressLine2: null,
              addressLine3: null,
              postcode: "12345",
              city: "Ipoh",
              stateProvince: "Perak",
              stateCode: null,
              countryCode: "MYS",
            },
          ],
        }
      : null,
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq(column: string, value: unknown) {
          state.filters.push([column, value]);
          return this;
        },
        maybeSingle: async () => ({ data: null, error: null }),
      }),
      upsert: async (row: Record<string, unknown>) => {
        state.rows.push(row);
        return { error: null };
      },
    }),
  },
}));
vi.mock("@/lib/audit.server", () => ({ logAudit: async () => {} }));

const id = "ccd0c599-1621-4e3b-b275-28f32403d0bb";
const url = `https://hotel.example/api/hotel/reservations/${id}/folio/bill-to`;
function put(body: unknown, origin = "https://hotel.example") {
  return new Request(url, { method: "PUT", headers: { origin }, body: JSON.stringify(body) });
}

describe("folio bill-to route", () => {
  beforeEach(() => {
    state.installed = false;
    state.policyError = false;
    state.allowed = true;
    state.exists = true;
    state.rows.length = 0;
    state.filters.length = 0;
  });
  it("reads the primary guest by default through a tenant-scoped lookup", async () => {
    const { handleReadBillTo } = await import("@/routes/api/hotel/reservations.$id.folio.bill-to");
    const response = await handleReadBillTo({ params: { id } });
    expect(response.status).toBe(200);
    expect((await response.json()).billTo).toMatchObject({
      name: "Guest",
      address: "Street\n12345 Ipoh\nPerak\nMYS",
    });
    expect(state.filters).toContainEqual(["tenant_id", "tenant-A"]);
    expect(state.filters).toContainEqual(["reservation_id", id]);
  });
  it("rejects cross-origin, unauthorized, invalid and missing records before writing", async () => {
    const { handleSaveBillTo } = await import("@/routes/api/hotel/reservations.$id.folio.bill-to");
    const bill = {
      name: "Guest",
      company: "Company",
      address: "Street",
      phone: "123",
      email: "guest@example.com",
    };
    expect(
      (await handleSaveBillTo({ request: put(bill, "https://evil.example"), params: { id } }))
        .status,
    ).toBe(403);
    state.allowed = false;
    expect((await handleSaveBillTo({ request: put(bill), params: { id } })).status).toBe(403);
    state.allowed = true;
    state.exists = false;
    expect((await handleSaveBillTo({ request: put(bill), params: { id } })).status).toBe(404);
    expect(state.rows).toHaveLength(0);
  });
  it("validates all fields and saves only under the trusted tenant and reservation", async () => {
    const { handleSaveBillTo } = await import("@/routes/api/hotel/reservations.$id.folio.bill-to");
    const bill = {
      name: "Guest",
      company: "Company",
      address: "Street",
      phone: "123",
      email: "guest@example.com",
    };
    expect(
      (await handleSaveBillTo({ request: put({ ...bill, email: "invalid" }), params: { id } }))
        .status,
    ).toBe(400);
    expect(state.rows).toHaveLength(0);
    const response = await handleSaveBillTo({
      request: put({ ...bill, tenant_id: "tenant-B" }),
      params: { id },
    });
    expect(response.status).toBe(200);
    expect(state.rows[0]).toMatchObject({ ...bill, tenant_id: "tenant-A", reservation_id: id });
  });
  it("installed contact controls refuse old flat PUT and failed policy reads cannot save", async () => {
    const { handleSaveBillTo } = await import("@/routes/api/hotel/reservations.$id.folio.bill-to");
    const bill = { name: "Guest", company: "", address: "", phone: "", email: "" };
    state.installed = true;
    const blocked = await handleSaveBillTo({ request: put(bill), params: { id } });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toEqual({ error: "version_required" });
    state.policyError = true;
    expect((await handleSaveBillTo({ request: put(bill), params: { id } })).status).toBe(500);
    expect(state.rows).toHaveLength(0);
  });
});
