import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ allowed: true, deposits: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/folio-api.server", () => ({
  requireFolioActor: async () =>
    state.allowed
      ? {
          actor: {
            tenantId: "tenant-A",
            actorKey: "owner",
            timezone: "Asia/Kuala_Lumpur",
            can: () => true,
          },
        }
      : { response: Response.json({ error: "forbidden" }, { status: 403 }) },
  folioDeny: (status: number, error: string) => Response.json({ error }, { status }),
  folioJson: (data: unknown) => Response.json(data),
  folioFailure: () => Response.json({ error: "folio_read_failed" }, { status: 500 }),
}));
vi.mock("@/lib/folio-store.server", () => ({
  buildFolioView: async () => ({
    reservation: { currency: "MYR" },
    totals: { grandTotal: 1114.55 },
  }),
}));
vi.mock("@/lib/deposits-store.server", async (original) => ({
  ...(await original<typeof import("@/lib/deposits-store.server")>()),
  listDeposits: async (tenantId: string, id: string) =>
    state.deposits.filter((d) => d.tenantId === tenantId && d.reservationId === id),
}));
// Deterministic, isolated receipt-overlay reader: the real overlay logic runs,
// but never against a live database (no receipt versions, nothing unresolved).
vi.mock("@/lib/effective-receipts.server", async (original) => {
  const mod = await original<typeof import("@/lib/effective-receipts.server")>();
  const isolated = { versions: async () => [], unresolved: async () => [] };
  return {
    ...mod,
    withEffectiveReceipts: (tenantId: string, rows: never[]) =>
      mod.withEffectiveReceipts(tenantId, rows, isolated),
  };
});
// Any attempt to reach the real service-role client fails the test loudly.
vi.mock("@/integrations/supabase/client.server", () => {
  throw new Error("unit test must not use the live database");
});
const { handleReadFolio } = await import("@/routes/api/hotel/reservations.$id.folio");
const id = "11111111-1111-4111-8111-111111111111";
const row = (status: string, amount: number, extra = {}) => ({
  id: "d1",
  tenantId: "tenant-A",
  reservationId: id,
  status,
  amount,
  currencyCode: "MYR",
  n3DocCode: "OR2610/001",
  createdAt: "2026-10-01T00:00:00Z",
  ...extra,
});
beforeEach(() => {
  state.allowed = true;
  state.deposits = [];
});
describe("recorded deposits on prepared folios", () => {
  it("deducts posted deposits in integer cents and includes receipt details", async () => {
    state.deposits = [
      row("posted", 50),
      row("failed", 90),
      row("unknown", 70),
      row("posted", 100, { tenantId: "tenant-B" }),
    ];
    const r = await handleReadFolio({ params: { id } });
    expect(r.status).toBe(200);
    expect((await r.json()).recordedDeposits).toMatchObject({
      total: 50,
      netFigure: 1064.55,
      hasUnconfirmed: true,
      items: [{ n3DocCode: "OR2610/001", amount: 50 }],
    });
  });
  it("shows a real zero with no deposits", async () => {
    const r = await handleReadFolio({ params: { id } });
    expect((await r.json()).recordedDeposits).toMatchObject({
      total: 0,
      netFigure: 1114.55,
      items: [],
    });
  });
  it.each([row("posted", 50, { currencyCode: "USD" }), row("posted", 50.001)])(
    "does not invent a balance for unsafe ledger amounts %j",
    async (bad) => {
      state.deposits = [bad];
      const r = await handleReadFolio({ params: { id } });
      expect(r.status).toBe(500);
    },
  );
  it("keeps access denied before exposing the prepared statement", async () => {
    state.allowed = false;
    expect((await handleReadFolio({ params: { id } })).status).toBe(403);
  });
});
