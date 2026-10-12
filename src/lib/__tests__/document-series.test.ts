import { describe, expect, it, vi } from "vitest";
import { createDocumentSeries } from "../document-series.server";
import type { SourcePolicyRpc } from "../source-billing-policy-store.server";
import type { SettlementActor } from "../settlement-context.server";
const actor: SettlementActor = {
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  n3UserKey: "owner",
  n3Token: "PRIVATE_TOKEN",
  role: "owner",
};
const op = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const clock = () => new Date("2026-09-30T16:01:00Z");
describe("local HotelHub document series", () => {
  it("uses Malaysia property date at UTC month boundary, keeping number separate from N3", async () => {
    const rpc = vi.fn<SourcePolicyRpc>(async () => ({
      data: {
        hhNumber: "SI261000001",
        documentDate: "2026-10-01",
        series: "bill",
        operationId: op,
        tenantId: actor.tenantId,
        reservationId: actor.reservationId,
      },
      error: null,
    }));
    expect(
      await createDocumentSeries(rpc, clock).reserve(
        actor,
        "bill",
        op,
        "2026-10-01",
        "Asia/Kuala_Lumpur",
      ),
    ).toEqual({ kind: "confirmed", value: { hhNumber: "SI261000001" } });
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_document_date: "2026-10-01",
      p_series: "bill",
      p_operation: op,
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("PRIVATE_TOKEN");
  });
  it.each(["receipt", "refund"] as const)(
    "%s series creates only a local identifier",
    async (series) => {
      const rpc = vi.fn<SourcePolicyRpc>(async () => ({
        data: {
          hhNumber: (series === "receipt" ? "OR" : "RF") + "261000001",
          documentDate: "2026-10-01",
          series,
          operationId: op,
          tenantId: actor.tenantId,
          reservationId: actor.reservationId,
        },
        error: null,
      }));
      expect(
        (
          await createDocumentSeries(rpc, clock).reserve(
            actor,
            series,
            op,
            "2026-10-01",
            "Asia/Kuala_Lumpur",
          )
        ).kind,
      ).toBe("confirmed");
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(rpc.mock.calls[0][0]).toBe("hh_source_document_number_reserve");
    },
  );
  it("rejects Front Desk, bad identity and wrong current property period before SQL", async () => {
    const rpc = vi.fn<SourcePolicyRpc>();
    const store = createDocumentSeries(rpc, clock);
    for (const [a, d, tz] of [
      [{ ...actor, role: "front_desk" }, "2026-10-01", "Asia/Kuala_Lumpur"],
      [actor, "2026-02-31", "Asia/Kuala_Lumpur"],
      [actor, "2026-10-01", "invalid"],
    ] as const)
      expect((await store.reserve(a, "bill", op, d, tz)).kind).not.toBe("confirmed");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects alien saved number/operation or incorrect prefix/period", async () => {
    const base = {
      hhNumber: "SI261000001",
      documentDate: "2026-10-01",
      series: "bill",
      operationId: op,
      tenantId: actor.tenantId,
      reservationId: actor.reservationId,
    };
    for (const change of [
      { tenantId: "other" },
      { operationId: "other" },
      { hhNumber: "SI260900001" },
      { hhNumber: "OR261000001" },
      { hhNumber: "SI261000000" },
    ]) {
      const rpc: SourcePolicyRpc = async () => ({ data: { ...base, ...change }, error: null });
      expect(
        await createDocumentSeries(rpc, clock).reserve(
          actor,
          "bill",
          op,
          "2026-10-01",
          "Asia/Kuala_Lumpur",
        ),
      ).toEqual({ kind: "unavailable", code: "source_document_number_unverified" });
    }
  });
  it("does not retry an uncertain reservation; saved operation can be checked later", async () => {
    const rpc = vi.fn<SourcePolicyRpc>(async () => {
      throw Error("timeout after SQL commit");
    });
    expect(
      await createDocumentSeries(rpc, clock).reserve(
        actor,
        "bill",
        op,
        "2026-10-01",
        "Asia/Kuala_Lumpur",
      ),
    ).toEqual({ kind: "unavailable", code: "source_document_number_unavailable" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
