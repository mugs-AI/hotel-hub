// Frozen source legs are recovered from immutable canonical preparation, never
// recalculated from today's whole-stay folio or a sibling's saved projection.
import type {
  ChargeLine,
  EvidenceResult,
  LinkedReceipt,
  SettlementSnapshot,
  SourceVersion,
} from "./settlement";
import type { SettlementActor } from "./settlement-context.server";
import type { LegStoredIntent, StoredSourceStay } from "./source-billing-store.server";
import { validateSourceBillPlan } from "./source-billing-store.server";
import { billingPayloadDigest } from "./n3-billing.server";
import { propertyTodayIso } from "./checkout-preview";
import { hasPermission } from "./rbac";
export type FrozenPreparation = {
  tenantId: string;
  reservationId: string;
  folioId: string;
  billDate: string;
  sourceVersions: SourceVersion[];
  lines: Omit<ChargeLine, "mappingEvidence">[];
  totalCents: number;
  digest: string;
};
export type FrozenSourceState = {
  stay: StoredSourceStay;
  preparation: FrozenPreparation | null;
  sourceVersions: SourceVersion[];
  status: string;
  folioStatus: string;
};
export type FrozenSourceDeps = {
  readState(a: SettlementActor): Promise<FrozenSourceState>;
  masters: {
    verifyLine(
      a: SettlementActor,
      h: { customerId: number; currencyId: number; currency: string; currencyRate: number },
      l: ChargeLine,
    ): Promise<EvidenceResult<ChargeLine>>;
    checkCurrent(a: SettlementActor): EvidenceResult<true>;
  };
  verifyReceipt(
    a: SettlementActor,
    s: SettlementSnapshot,
    r: LinkedReceipt,
  ): Promise<EvidenceResult<LinkedReceipt>>;
  now(): Date;
};
const equal = (a: unknown, b: unknown) => billingPayloadDigest(a) === billingPayloadDigest(b);
const stopped = (r: { kind: "unavailable" | "contradiction"; code: string }) =>
  r.code === "n3_unauthorized" ? { kind: "unavailable" as const, code: "n3_session_expired" } : r;
class FrozenFailure extends Error {
  constructor(
    code: string,
    readonly kind: "unavailable" | "contradiction" = "contradiction",
  ) {
    super(code);
  }
}
function fail(code: string, kind: "unavailable" | "contradiction" = "contradiction"): never {
  throw new FrozenFailure(code, kind);
}
export async function loadFrozenSourceLeg(
  actor: SettlementActor,
  input: LegStoredIntent,
  d: FrozenSourceDeps,
): Promise<EvidenceResult<SettlementSnapshot>> {
  const a = Object.freeze({ ...actor }),
    leg = structuredClone(input);
  function current() {
    for (const k of ["tenantId", "reservationId", "n3UserKey", "n3Token", "role"] as const)
      if (a[k] !== actor[k]) fail("settlement_scope_mismatch");
  }
  function validate(state: FrozenSourceState) {
    const p = validateSourceBillPlan(state.stay.plan, a),
      selected = p.legs.find((l) => l.legId === leg.legId);
    if (
      state.stay.tenantId !== a.tenantId ||
      state.stay.reservationId !== a.reservationId ||
      leg.id !== leg.legId ||
      leg.planDigest !== p.digest ||
      !selected ||
      selected.kind !== leg.legKind ||
      !equal(selected.snapshot, leg.snapshot)
    )
      fail("settlement_scope_mismatch");
    const s = selected.snapshot,
      prep = state.preparation;
    if (
      state.status !== "checked_in" ||
      state.folioStatus !== "prepared" ||
      !equal(state.sourceVersions, s.sourceVersions)
    )
      fail("settlement_snapshot_changed");
    if (!prep) fail("settlement_preparation_missing", "unavailable");
    const lines = p.legs
      .flatMap((l) => l.snapshot.lines)
      .map(({ mappingEvidence: _m, ...l }) => l)
      .sort((x, y) => x.localLineId.localeCompare(y.localLineId));
    if (
      prep.tenantId !== a.tenantId ||
      prep.reservationId !== a.reservationId ||
      prep.folioId !== s.folioId ||
      prep.billDate !== s.billDate ||
      prep.totalCents !== p.totalCents ||
      !equal(prep.sourceVersions, s.sourceVersions) ||
      !equal(prep.lines, lines) ||
      prep.digest !==
        billingPayloadDigest({
          sourceVersions: prep.sourceVersions,
          lines: prep.lines,
          billDate: prep.billDate,
          totalCents: prep.totalCents,
        })
    )
      fail("settlement_preparation_mismatch");
    const today = propertyTodayIso(s.propertyTimezone, d.now());
    if (!today || s.billDate > today) fail("settlement_snapshot_changed");
    return s;
  }
  try {
    if (
      !hasPermission(a.role, "hotel:checkout:write") ||
      !a.n3Token?.trim() ||
      !a.n3UserKey?.trim()
    )
      fail("settlement_forbidden");
    const before = await d.readState(a);
    current();
    const s = validate(before);
    for (const line of s.lines) {
      const r = await d.masters.verifyLine(
        a,
        {
          customerId: s.customerId,
          currencyId: s.currencyId,
          currency: s.currency,
          currencyRate: s.currencyRate,
        },
        structuredClone(line),
      );
      current();
      if (r.kind !== "confirmed") return stopped(r);
      if (!equal(r.value, line)) fail("settlement_snapshot_changed");
    }
    for (const receipt of s.receipts) {
      const r = await d.verifyReceipt(a, s, structuredClone(receipt));
      current();
      if (r.kind !== "confirmed") return stopped(r);
      if (!equal(r.value, receipt)) fail("settlement_snapshot_changed");
    }
    const after = await d.readState(a);
    current();
    validate(after);
    const proof = d.masters.checkCurrent(a);
    if (proof.kind !== "confirmed") return stopped(proof);
    return { kind: "confirmed", value: structuredClone(s) };
  } catch (e) {
    if (e instanceof FrozenFailure) return { kind: e.kind, code: e.message };
    return {
      kind: "unavailable",
      code:
        e instanceof Error && /^(?:settlement_|source_|n3_)[a-z_]{1,90}$/.test(e.message)
          ? e.message
          : "settlement_frozen_read_unavailable",
    };
  }
}
