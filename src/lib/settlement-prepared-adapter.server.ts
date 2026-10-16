import type { SettlementActor } from "./settlement-context.server";
import type { EvidenceResult, LinkedReceipt, SettlementSnapshot } from "./settlement";
import {
  loadSettlementSnapshot,
  snapshotDigest,
  type SnapshotDeps,
  type SnapshotFacts,
} from "./settlement-snapshot.server";
import { billingPayloadDigest } from "./n3-billing.server";
export type PreparedSnapshotPorts = {
  readFacts(actor: SettlementActor): Promise<EvidenceResult<SnapshotFacts>>;
  verifyLine: SnapshotDeps["verifyLine"];
  verifyReceipt(
    actor: SettlementActor,
    snapshot: SettlementSnapshot,
    receipt: LinkedReceipt,
  ): Promise<EvidenceResult<LinkedReceipt>>;
  now(): Date;
};
function comparison(s: SettlementSnapshot) {
  const { digest: _digest, billDate: _date, folioProjection, ...facts } = s;
  if (!folioProjection) return { ...facts, folioProjection: null };
  const { propertyDate: _propertyDate, ...folio } = folioProjection.folio;
  return { ...facts, folioProjection: { version: folioProjection.version, folio } };
}
/** A new snapshot is validated before proving its linked receipts. For an
 * existing intent the original date/projection/digest remains authoritative;
 * current local facts and accounting mappings must still agree exactly. */
export async function loadPreparedSettlementSnapshot(
  actor: SettlementActor,
  ports: PreparedSnapshotPorts,
  frozen?: SettlementSnapshot,
): Promise<EvidenceResult<SettlementSnapshot>> {
  const a = Object.freeze({ ...actor }),
    saved = frozen ? structuredClone(frozen) : undefined;
  function current() {
    if (
      ["tenantId", "reservationId", "role", "n3UserKey", "n3Token"].some(
        (k) => actor[k as keyof SettlementActor] !== a[k as keyof SettlementActor],
      )
    )
      throw Error("settlement_scope_mismatch");
  }
  try {
    if (saved) {
      const { digest, ...facts } = saved;
      if (
        saved.tenantId !== a.tenantId ||
        saved.reservationId !== a.reservationId ||
        digest !== snapshotDigest(facts)
      )
        return { kind: "contradiction", code: "settlement_scope_mismatch" };
    }
    current();
    const raw = await ports.readFacts(a);
    current();
    if (raw.kind !== "confirmed") return raw;
    const facts = structuredClone(raw.value);
    if (saved && facts.folioProjection) facts.folioProjection.folio.propertyDate = saved.billDate;
    const base = await loadSettlementSnapshot(a, {
      now: ports.now,
      frozenBillDate: saved?.billDate,
      readFacts: async () => ({ ...facts, receipts: [] }),
      verifyLine: async (bound, line) => {
        current();
        const r = await ports.verifyLine(bound, line);
        current();
        return r;
      },
      verifyReceipt: async () => ({
        kind: "unavailable",
        code: "settlement_receipt_proof_required",
      }),
    });
    current();
    if (base.kind !== "confirmed") return base;
    const { digest: _digest, ...mapped } = base.value;
    const complete = {
      ...mapped,
      receipts: [...facts.receipts].sort(
        (a, b) =>
          a.receiptDate.localeCompare(b.receiptDate) || a.receiptId.localeCompare(b.receiptId),
      ),
    };
    const candidate: SettlementSnapshot = { ...complete, digest: snapshotDigest(complete) };
    if (
      saved &&
      billingPayloadDigest(comparison(candidate)) !== billingPayloadDigest(comparison(saved))
    )
      return { kind: "contradiction", code: "settlement_snapshot_changed" };
    const proofSnapshot = saved ?? candidate;
    const final = await loadSettlementSnapshot(a, {
      now: ports.now,
      frozenBillDate: saved?.billDate,
      readFacts: async () => facts,
      verifyLine: async (_a, line) => {
        current();
        const checked = base.value.lines.find((l) => l.localLineId === line.localLineId);
        return checked
          ? { kind: "confirmed", value: checked }
          : { kind: "contradiction", code: "settlement_snapshot_changed" };
      },
      verifyReceipt: async (bound, receipt) => {
        current();
        const r = await ports.verifyReceipt(bound, proofSnapshot, receipt);
        current();
        return r;
      },
    });
    current();
    if (final.kind !== "confirmed") return final;
    if (final.value.digest !== candidate.digest)
      return { kind: "contradiction", code: "settlement_snapshot_changed" };
    return { kind: "confirmed", value: saved ?? final.value };
  } catch (error) {
    return {
      kind: "contradiction",
      code:
        error instanceof Error && error.message === "settlement_scope_mismatch"
          ? error.message
          : "settlement_snapshot_changed",
    };
  }
}
