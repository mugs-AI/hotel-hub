import { describe, expect, it, vi } from "vitest";
import {
  captureSettlementMasters,
  type MasterCaptureInput,
} from "../n3-settlement-master-diagnostics.server";
import type { MasterCaptureActor } from "../n3-settlement-master-diagnostics.server";
const actor: MasterCaptureActor = {
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  role: "owner",
  n3UserKey: "fixture-owner",
  n3Token: "fixture-private-token",
};
const input: MasterCaptureInput = {
  masters: [
    { kind: "customer", id: 71 },
    { kind: "currency", id: 1 },
    { kind: "stock", id: 101 },
    { kind: "uom", id: 2 },
    { kind: "tax", id: 3 },
    { kind: "account", id: "11111111-1111-4111-8111-111111111111" },
  ],
};
describe("bounded Owner master GET diagnostics", () => {
  it("captures all fixed detail paths using the current Owner session and never POSTs", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        code: "0000",
        data: {
          id: 71,
          isActive: true,
          arAccount: { id: "11111111-1111-4111-8111-111111111111", code: "700-C001" },
        },
      }),
    );
    const result = await captureSettlementMasters(actor, input, { fetcher });
    expect(result.status).toBe("captured");
    expect(result.contractAccepted).toBe(false);
    expect(result.evidence.map((e) => e.endpoint)).toEqual([
      "/api/Customers/71",
      "/api/Currencies/1",
      "/api/Stocks/101",
      "/api/UOMs/2",
      "/api/TaxCodes/3",
      "/api/AccountCodes/11111111-1111-4111-8111-111111111111",
    ]);
    for (const [url, init] of fetcher.mock.calls as unknown as [string, RequestInit][]) {
      expect(url).toMatch(/^https:\/\/openapi\.account\.qne\.cloud\/api\//);
      expect(init.method).toBe("GET");
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer " + actor.n3Token);
    }
  });
  it("retains account relationships, booleans and rates while excluding credentials, tenant and personal text", async () => {
    const raw = {
      code: "0000",
      data: {
        id: 101,
        isActive: false,
        rate: 0.06,
        salesAccount: { id: "11111111-1111-4111-8111-111111111111", type: { typeCode: "REV" } },
        tenantId: actor.tenantId,
        contactName: "Private Guest",
        token: actor.n3Token,
        notes: actor.n3Token,
        arbitraryKey: actor.tenantId,
      },
    };
    const result = await captureSettlementMasters(
      actor,
      { masters: [{ kind: "stock", id: 101 }] },
      { fetcher: async () => Response.json(raw) },
    );
    const sample = result.evidence[0].sample;
    expect(sample).toMatchObject({
      code: "0000",
      data: { id: 101, isActive: false, rate: 0.06, salesAccount: { type: { typeCode: "REV" } } },
    });
    expect(JSON.stringify(result)).not.toContain(actor.n3Token);
    expect(JSON.stringify(result)).not.toContain(actor.tenantId);
    expect(JSON.stringify(result)).not.toContain("Private Guest");
    expect(result.evidence[0].responseHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each(["front_desk", "housekeeper"] as const)("refuses %s before any request", async (role) => {
    const fetcher = vi.fn();
    await expect(captureSettlementMasters({ ...actor, role }, input, { fetcher })).rejects.toThrow(
      "forbidden",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    { masters: [] },
    { masters: [{ kind: "stock", id: "../Secret" }] },
    { masters: [{ kind: "customer", id: 0 }] },
    { masters: [{ kind: "account", id: 71 }] },
    { masters: [{ kind: "bill", id: 71 }] },
    {
      masters: [
        { kind: "stock", id: 1 },
        { kind: "stock", id: 1 },
      ],
    },
    { ...input, tenantId: "alien" },
    { masters: Array.from({ length: 21 }, (_, i) => ({ kind: "stock", id: i + 1 })) },
  ])("rejects unbounded or foreign scope %j", async (invalid) => {
    const fetcher = vi.fn();
    await expect(
      captureSettlementMasters(actor, invalid as MasterCaptureInput, { fetcher }),
    ).rejects.toThrow("invalid_request");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("stops sibling reads on 401", async () => {
    const fetcher = vi.fn(async () => new Response("private upstream message", { status: 401 }));
    const result = await captureSettlementMasters(actor, input, { fetcher });
    expect(result.status).toBe("unauthorized");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("private upstream message");
  });
  it("records malformed, oversized and rejected responses as unavailable", async () => {
    for (const response of [
      new Response("not JSON", { status: 200 }),
      Response.json({ code: "FAIL", data: { id: 1 } }),
      new Response("x".repeat(1_000_001), { status: 200 }),
    ]) {
      const r = await captureSettlementMasters(
        actor,
        { masters: [{ kind: "stock", id: 101 }] },
        { fetcher: async () => response },
      );
      expect(r.status).toBe("partial");
      expect(r.evidence[0].sample).toBe(null);
    }
  });
  it("marks a truncated structural sample incomplete", async () => {
    const result = await captureSettlementMasters(
      actor,
      { masters: [{ kind: "stock", id: 101 }] },
      {
        fetcher: async () =>
          Response.json({
            code: "0000",
            data: { id: 101, uoms: Array.from({ length: 101 }, (_, i) => ({ id: i + 1 })) },
          }),
      },
    );
    expect(result.status).toBe("partial");
    expect(result.evidence[0]).toMatchObject({ sampleTruncated: true });
  });
  it("redacts unknown and personal scalar paths while preserving exact master relationships", async () => {
    const raw = {
      code: "0000",
      data: {
        id: 71,
        arAccount: { id: "11111111-1111-4111-8111-111111111111", type: { typeCode: "BCA" } },
        nationalId: "900101145555",
        birthDate: "1990-01-01",
        phone: 60123456789,
        postalCode: "53000",
        unknownNumber: 123456789,
        profile: { id: "88888888-8888-4888-8888-888888888888", code: "PERSONAL-CODE" },
      },
    };
    const result = await captureSettlementMasters(
      actor,
      { masters: [{ kind: "customer", id: 71 }] },
      { fetcher: async () => Response.json(raw) },
    );
    expect(result.evidence[0].sample).toMatchObject({
      code: "0000",
      data: { id: 71, arAccount: { type: { typeCode: "BCA" } } },
    });
    for (const privateValue of [
      "900101145555",
      "1990-01-01",
      "60123456789",
      "53000",
      "123456789",
      "88888888-8888-4888-8888-888888888888",
      "PERSONAL-CODE",
    ])
      expect(JSON.stringify(result)).not.toContain(privateValue);
  });
});
