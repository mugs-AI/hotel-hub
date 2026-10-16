import { afterEach, expect, it, vi } from "vitest";
import { checkExternalMatchingClient } from "../settlement-client";
import {
  fixtureActor as actor,
  fixtureIntentId as intentId,
  fixtureBillId as billId,
} from "./fixtures/settlement-evidence";
afterEach(() => vi.unstubAllGlobals());
const report = () => ({
  tenantId: actor.tenantId,
  reservationId: actor.reservationId,
  intentId,
  status: "confirmed",
  code: "external_matching_observed",
  checkedAt: "2026-10-14T02:00:00Z",
  billOutstandingCents: 0,
  documents: [{ id: billId, code: "SYNTHETIC-BILL", kind: "bill" }],
  externalMatching: {
    provenance: "external_n3_matching",
    canClose: false,
    matches: [],
    receiptObservations: [],
  },
});
it.each([
  { documents: undefined },
  { documents: [{ id: billId }] },
  { billOutstandingCents: 1 },
  { checkedAt: "invalid" },
  { externalMatching: { provenance: "external_n3_matching", canClose: false } },
])("rejects incomplete matching data without exposing false success %j", async (change) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ ...report(), ...change })),
  );
  await expect(checkExternalMatchingClient(actor.reservationId, intentId)).rejects.toThrow(
    "saved_check_scope_mismatch",
  );
});
it("projects only the public matching fields needed for checkout", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ ...report(), unexpectedPrivateField: "private-synthetic-value" }),
    ),
  );
  const result = await checkExternalMatchingClient(actor.reservationId, intentId);
  expect(result.documents[0].code).toBe("SYNTHETIC-BILL");
  expect(JSON.stringify(result)).not.toContain("private-synthetic-value");
});
