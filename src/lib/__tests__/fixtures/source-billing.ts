import { partitionSourceBill } from "../../source-billing-plan.server";
import { snapshotDigest } from "../../settlement-snapshot.server";
import { settlementFixture } from "./settlement";
import type { SettlementActor } from "../../settlement-context.server";
import type { SourceBillPlan } from "../../source-billing";
export const source = "44444444-4444-4444-8444-444444444444";
export const guest = "55555555-5555-4555-8555-555555555555";
export const request = "66666666-6666-4666-8666-666666666666";
const extra = "33333333-3333-4333-8333-333333333333";
export const actor: SettlementActor = {
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  role: "owner",
  n3UserKey: "synthetic-owner",
  n3Token: "private-test-token",
};
export function plan(): SourceBillPlan {
  const s = settlementFixture({ receipts: [] });
  s.lines[0].unitCents = s.lines[0].subtotalCents = s.lines[0].totalCents = 30000;
  s.lines.push({
    ...s.lines[0],
    localLineId: extra,
    kind: "add_on",
    unitCents: 4000,
    subtotalCents: 4000,
    totalCents: 4000,
  });
  for (const l of s.lines)
    l.mappingEvidence = {
      arAccountId: "77777777-7777-4777-8777-777777777777",
      arAccountCode: "SYNTHETIC-AR",
      customerId: 7,
      customerCode: "SYNTHETIC-CUSTOMER",
      salesAccountId: "88888888-8888-4888-8888-888888888888",
      salesAccountCode: "SYNTHETIC-SALES",
    };
  s.totalCents = 34000;
  const { digest: _d, ...facts } = s;
  s.digest = snapshotDigest(facts);
  const result = partitionSourceBill(
    s,
    {
      policy: {
        sourceId: extra,
        version: "1",
        defaultCollectionMode: "source",
        allowedCollectionModes: ["source", "guest"],
        sourceCustomerId: 8,
        guestCustomerId: 7,
        guestDocumentTitle: "Source Sales",
        guestItemDescription: "Accommodation",
        showRoomPrices: false,
      },
      collectionMode: "source",
      confirmedBy: actor.n3UserKey,
      confirmedAt: "2026-10-12T00:00:00.000Z",
    },
    new Map(),
    { source, guest },
    new Map([
      [
        8,
        {
          tenantId: s.tenantId,
          customerId: 8,
          currencyId: 1,
          currencyRate: 1,
          billTo: { name: "Synthetic source", company: "", address: "", phone: "", email: "" },
        },
      ],
    ]),
  );
  if (result.kind !== "confirmed") throw Error(result.code);
  return result.value;
}
export function saved(p = plan()): import("../../source-billing-store.server").StoredSourceStay {
  return {
    tenantId: actor.tenantId,
    reservationId: actor.reservationId,
    revision: "1",
    plan: p,
    legs: p.legs.map((l, i) => ({
      id: l.legId,
      tenantId: actor.tenantId,
      reservationId: actor.reservationId,
      legId: l.legId,
      legKind: l.kind,
      planDigest: p.digest,
      hhNumber: "SI26100000" + (i + 1),
      revision: "1",
      state: "frozen",
      snapshot: l.snapshot,
      dispatches: [],
      evidence: [],
    })),
  };
}
