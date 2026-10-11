import { changeAdmin, requireFreshChangeOwner } from "./hotel-change-controls-store.server";
import { resolveAutomationActor } from "./receipt-automation-deps.server";
import { readReceiptControlEvidence, unwrap } from "./receipt-controls-evidence.server";
import { n3Receipts } from "./n3-receipts.server";
import { productionUpdateContract, updateN3Receipt } from "./n3-receipt-update.server";
import { ReceiptControlError } from "./receipt-controls";
import type { ProofPackage, ProofPermit, ProofDb, ProofDeps } from "./receipt-update-proof.server";
import type { ReceiptAutomationActor } from "./receipt-automation-gates.server";
export { resolveAutomationActor };
// Owner-designated disposable OR only; never use the existing booking receipt.
// This source manifest does not enable the tool. Runtime activation and hosting
// adequacy remain separate release gates. sourceRef identifies the reviewed
// adapter baseline; 30s is the local operation cap, not a hosting-limit claim.
const FOLLOW_UP_PROOF_BASE = {
  tenantKey: "ca75ed66-69ac-40d9-92f1-f6b3a8780fdd",
  companyName: "9AC-0D9-2F1 · MUGS AI LAB TEST SDN. BHD.",
  receiptId: "3a0d118c-de6d-40bd-3bc2-08df269c5e9f",
  docCode: "OR2610/002",
  documentDate: "2026-10-10",
  reference: null,
  customerId: "1382639",
  customerCode: "700-7001",
  accountId: "c3c22459-c2b7-4c43-8e43-8b52a9adabda",
  accountCode: "700-0310",
  expiresAt: Date.parse("2026-10-11T20:00:00+08:00"),
  budgetMs: 30000,
  sourceRef: "b5b168d323dbba002a2967dadf80a70c75a7c710",
};
// Two distinct packages/permits; never reset or renew the completed historical
// permit. The server checks the exact current amount before either dispatch.
const APPROVED_PROOF_PACKAGES: readonly ProofPackage[] = [
  {
    ...FOLLOW_UP_PROOF_BASE,
    caseId: "OR2610-002-65-to-50-20261011",
    beforeCents: 6500,
    afterCents: 5000,
  },
  {
    ...FOLLOW_UP_PROOF_BASE,
    caseId: "OR2610-002-50-to-65-20261011",
    beforeCents: 5000,
    afterCents: 6500,
  },
];
function map(row: Record<string, unknown>): ProofPermit {
  const binding = row.binding as Omit<ProofPermit, "id" | "phase" | "report">;
  return {
    ...binding,
    id: row.id as string,
    phase: row.phase as ProofPermit["phase"],
    report: row.report as ProofPermit["report"],
  };
}
async function rpc(a: ReceiptAutomationActor, name: string, data: unknown) {
  const r = await (
    await changeAdmin()
  ).rpc(name, { p_tenant_id: a.tenantId, p_actor: a.n3UserKey, p_role: a.role, p_data: data });
  if (r.error) throw new ReceiptControlError("proof_store_unavailable");
  return r.data;
}
const db: ProofDb = {
  async listHeld(a) {
    const r = await (await changeAdmin())
      .from("hotel_receipt_update_proof_permits")
      .select("*")
      .eq("tenant_id", a.tenantId)
      .eq("owner_key", a.n3UserKey)
      .in("phase", ["reserved", "unknown"])
      .order("created_at", { ascending: false })
      .limit(10);
    if (r.error) throw new ReceiptControlError("proof_store_unavailable");
    return (r.data ?? []).map(map);
  },
  async create(row) {
    return map(
      await rpc(
        {
          tenantId: row.tenantId,
          n3UserKey: row.ownerKey,
          role: "owner",
          n3TenantKey: row.package.tenantKey,
          n3Token: "",
        },
        "hotelhub_receipt_proof_prepare",
        { ...row, receiptId: row.package.receiptId, tenantKey: row.package.tenantKey },
      ),
    );
  },
  async get(a, id) {
    const r = await (await changeAdmin())
      .from("hotel_receipt_update_proof_permits")
      .select("*")
      .eq("tenant_id", a.tenantId)
      .eq("owner_key", a.n3UserKey)
      .eq("id", id)
      .maybeSingle();
    if (r.error) throw new ReceiptControlError("proof_store_unavailable");
    return r.data ? map(r.data) : null;
  },
  async claim(a, id, payloadHash) {
    return (
      (await rpc(a, "hotelhub_receipt_proof_claim", { id, payloadHash })).dispatchGranted === true
    );
  },
  async finish(a, id, phase, report) {
    await rpc(a, "hotelhub_receipt_proof_finish", { id, phase, report });
  },
};
export function defaultReceiptProofDeps(): ProofDeps {
  return {
    enabled:
      process.env.HOTELHUB_RECEIPT_PROOF_ENABLED === "true" && APPROVED_PROOF_PACKAGES.length > 0,
    packages: APPROVED_PROOF_PACKAGES,
    contract: productionUpdateContract(),
    now: Date.now,
    freshOwner: requireFreshChangeOwner,
    db,
    async isHotelReceipt(id) {
      const r = await (await changeAdmin())
        .from("hotel_reservation_deposits")
        .select("id")
        .eq("n3_receipt_id", id)
        .limit(1);
      if (r.error) throw new ReceiptControlError("proof_store_unavailable");
      return r.data.length > 0;
    },
    async read(a, p, limit) {
      let raw: unknown = null;
      const snapshot = await readReceiptControlEvidence(a, p.receiptId, {
        allowNullReferenceForProof: p.reference === null,
        loadDeposit: async () => ({
          id: p.receiptId,
          reservationId: p.receiptId,
          status: "posted",
          n3ReceiptId: p.receiptId,
          n3DocCode: p.docCode,
          n3CustomerId: p.customerId,
          n3CustomerCode: p.customerCode,
          n3ReferenceNo: p.reference,
          currencyCode: "MYR",
          paymentLines: [
            {
              id: p.accountId,
              code: p.accountCode,
              name: p.accountCode,
              amount: p.beforeCents / 100,
            },
          ],
        }),
        n3: {
          async getById(token, id) {
            const out = await n3Receipts.getById(token, id, limit);
            if (out.kind === "response") raw = unwrap(out.body);
            return out;
          },
          getGLPosting: (token, id) => n3Receipts.getGLPosting(token, id, limit),
        },
      });
      return { snapshot, raw };
    },
    send: updateN3Receipt,
  };
}
