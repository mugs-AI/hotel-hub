import { z } from "zod";
import type { SettlementActor } from "./settlement-context.server";
import type { EvidenceResult, SettlementSnapshot } from "./settlement";
import type { ReservationPayerSnapshot } from "./source-billing";
import { parseSourceBillingPolicy } from "./source-billing-policy.server";
import { billingPayloadDigest } from "./n3-billing.server";
import { snapshotDigest } from "./settlement-snapshot.server";
import { validateSourceBillPlan } from "./source-billing-store.server";
import {
  attributionAssignmentSchema,
  attributionSaveSchema,
  parseAttributionView,
  type AttributionSave,
  type AttributionView,
} from "./charge-attribution";
const uuid = z.string().uuid(),
  rev = z
    .string()
    .regex(/^[1-9]\d{0,18}$/)
    .refine((v) => BigInt(v) <= 9223372036854775807n);
const basisSchema = z
  .object({
    tenantId: uuid,
    reservationId: uuid,
    folioId: uuid,
    payerRevision: rev,
    billDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
    sourceVersions: z
      .array(
        z.object({ table: z.string().max(100), id: uuid, version: z.string().min(1).max(100) }),
      )
      .max(30000),
    rows: z
      .array(
        z.object({
          lineId: uuid,
          kind: z.enum(["room_night", "add_on", "service_charge", "tourism_tax", "local_levy"]),
          description: z.string().min(1).max(160),
          totalCents: z.number().int().min(0).max(1000000000),
        }),
      )
      .min(1)
      .max(10000),
  })
  .strict();
type Basis = z.infer<typeof basisSchema>;
/** Private preparation port: never serialize this canonical snapshot or fence. */
export type PreparedChargeAttribution = {
  snapshot: SettlementSnapshot;
  payer: ReservationPayerSnapshot;
  payerRevision: string;
  basisDigest: string;
  stateDigest: string;
  assignments: Map<string, "guest" | "source_room">;
};
const recordSchema = z
  .object({
    revision: rev,
    basis: basisSchema,
    basisDigest: z.string().regex(/^[a-f0-9]{64}$/),
    assignments: z.array(attributionAssignmentSchema).min(1).max(10000),
  })
  .strict();
type Saved = z.infer<typeof recordSchema>;
export type AttributionRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
export type AttributionDeps = {
  rpc: AttributionRpc;
  snapshot(
    a: SettlementActor,
    payer: ReservationPayerSnapshot,
  ): Promise<EvidenceResult<SettlementSnapshot>>;
};
function fail(code: string): never {
  throw Error(code);
}
function guard(a: SettlementActor, write = false) {
  if (
    !uuid.safeParse(a.tenantId).success ||
    !uuid.safeParse(a.reservationId).success ||
    !a.n3Token?.trim() ||
    !a.n3UserKey?.trim() ||
    !["owner", "front_desk"].includes(a.role) ||
    (write && a.role !== "owner")
  )
    fail("forbidden");
}
function same(a: SettlementActor, b: SettlementActor) {
  for (const k of ["tenantId", "reservationId", "n3UserKey", "n3Token", "role"] as const)
    if (a[k] !== b[k]) fail("source_attribution_scope_mismatch");
}
function assignmentsFor(b: Basis, assignments: Saved["assignments"], mode: string) {
  const map = new Map(assignments.map((x) => [x.lineId, x.leg]));
  if (
    map.size !== assignments.length ||
    map.size !== b.rows.length ||
    b.rows.some((r) => !map.has(r.lineId)) ||
    (mode === "guest" && assignments.some((x) => x.leg !== "guest")) ||
    (mode === "source" && !assignments.some((x) => x.leg === "source_room"))
  )
    fail("source_charge_attribution_invalid");
  return map;
}
function saved(raw: unknown): Saved | null {
  if (raw === null) return null;
  const r = recordSchema.parse(raw);
  if (
    billingPayloadDigest(r.basis) !== r.basisDigest ||
    new Set(r.basis.rows.map((x) => x.lineId)).size !== r.basis.rows.length
  )
    fail("source_attribution_scope_mismatch");
  return r;
}
function view(
  actor: SettlementActor,
  payer: ReservationPayerSnapshot,
  basis: Basis,
  record: Saved | null,
  frozen = false,
): AttributionView {
  if (
    record &&
    (record.basis.tenantId !== actor.tenantId || record.basis.reservationId !== actor.reservationId)
  )
    fail("source_attribution_scope_mismatch");
  const digest = billingPayloadDigest(basis),
    stale = !!record && record.basisDigest !== digest;
  if (record && !stale) assignmentsFor(basis, record.assignments, payer.collectionMode);
  const old = new Map(record?.assignments.map((x) => [x.lineId, x.leg]) ?? []);
  const rows = basis.rows.map((r) => ({
    ...r,
    leg:
      payer.collectionMode === "guest"
        ? ("guest" as const)
        : (old.get(r.lineId) ??
          (r.kind === "room_night"
            ? ("source_room" as const)
            : r.kind === "add_on"
              ? ("guest" as const)
              : null)),
  }));
  return parseAttributionView(
    {
      tenantId: actor.tenantId,
      reservationId: actor.reservationId,
      revision: record?.revision ?? "0",
      basisDigest: digest,
      frozen,
      stale,
      collectionMode: payer.collectionMode,
      currency: basis.currency,
      guestCustomerId: payer.policy.guestCustomerId,
      sourceCustomerId: payer.policy.sourceCustomerId,
      rows,
      blockers: [
        ...(stale ? ["source_attribution_stale"] : []),
        ...(rows.some((r) => !r.leg) ? ["source_charge_attribution_required"] : []),
      ],
    },
    actor.tenantId,
    actor.reservationId,
  );
}
export function createChargeAttributionService(d: AttributionDeps) {
  async function rpc(actor: SettlementActor, name: string, args: Record<string, unknown>) {
    const a = { ...actor };
    const r = await d.rpc(name, {
      p_tenant: a.tenantId,
      p_reservation: a.reservationId,
      p_actor: a.n3UserKey,
      p_role: a.role,
      ...args,
    });
    same(actor, a);
    if (r.error) {
      const code = r.error.message?.match(
        /\b(?:source_[a-z_]+|settlement_[a-z_]+|reservation_not_found)\b/,
      )?.[0];
      fail(code ?? "source_attribution_setup_required");
    }
    return r.data;
  }
  async function readState(actor: SettlementActor) {
    guard(actor);
    const a = Object.freeze({ ...actor }),
      raw = await rpc(actor, "hh_source_attribution_get", {});
    same(actor, a);
    const header = z
      .object({
        tenantId: uuid,
        reservationId: uuid,
        payerRevision: rev,
        payer: z.unknown(),
        frozen: z.boolean(),
        record: z.unknown(),
        frozenPlan: z.object({ payerRevision: rev, plan: z.unknown() }).nullable().optional(),
      })
      .parse(raw);
    if (header.tenantId !== a.tenantId || header.reservationId !== a.reservationId)
      fail("source_attribution_scope_mismatch");
    if (!header.payer || typeof header.payer !== "object") fail("source_payer_required");
    const p = header.payer as ReservationPayerSnapshot,
      policy = parseSourceBillingPolicy(p.policy, p.policy?.sourceId);
    if (
      policy.kind !== "confirmed" ||
      !["guest", "source"].includes(p.collectionMode) ||
      !policy.value.allowedCollectionModes.includes(p.collectionMode)
    )
      fail("source_payer_required");
    const payer: ReservationPayerSnapshot = {
      policy: policy.value,
      collectionMode: p.collectionMode,
      confirmedBy: p.confirmedBy,
      confirmedAt: p.confirmedAt,
    };
    const record = saved(header.record);
    if (header.frozen) {
      if (!record) fail("source_attribution_frozen");
      if (record.basis.payerRevision !== header.payerRevision) fail("source_attribution_changed");
      if (!header.frozenPlan) fail("source_attribution_frozen_unverified");
      const frozen = validateSourceBillPlan(header.frozenPlan.plan, a);
      if (
        header.frozenPlan.payerRevision !== header.payerRevision ||
        billingPayloadDigest(frozen.payer) !== billingPayloadDigest(payer)
      )
        fail("source_attribution_changed");
      const first = frozen.legs[0].snapshot;
      // Only immutable stored plan facts establish history. Today's calculator,
      // raw sources or a digest compared with itself cannot establish it.
      const frozenBasis = basisSchema.parse({
        tenantId: a.tenantId,
        reservationId: a.reservationId,
        folioId: first.folioId,
        payerRevision: header.payerRevision,
        billDate: first.billDate,
        currency: first.currency,
        sourceVersions: first.sourceVersions,
        rows: frozen.legs
          .flatMap((leg) =>
            leg.snapshot.lines.map((line) => ({
              lineId: line.localLineId,
              kind: line.kind,
              description: line.description,
              totalCents: line.totalCents,
            })),
          )
          .sort((x, y) => x.lineId.localeCompare(y.lineId)),
      });
      const allocation = assignmentsFor(record.basis, record.assignments, payer.collectionMode);
      if (
        billingPayloadDigest(frozenBasis) !== record.basisDigest ||
        frozen.legs.some((leg) =>
          leg.snapshot.lines.some((line) => allocation.get(line.localLineId) !== leg.kind),
        )
      )
        fail("source_attribution_changed");
      return {
        basis: frozenBasis,
        payer,
        record,
        output: view(a, payer, frozenBasis, record, true),
      };
    }
    const snap = await d.snapshot(a, payer);
    same(actor, a);
    if (snap.kind !== "confirmed") fail(snap.code);
    const s = snap.value,
      { digest, ...facts } = s;
    if (
      s.tenantId !== a.tenantId ||
      s.reservationId !== a.reservationId ||
      s.customerId !== payer.policy.guestCustomerId ||
      snapshotDigest(facts) !== digest ||
      s.lines.reduce((n, l) => n + l.totalCents, 0) !== s.totalCents
    )
      fail("source_attribution_scope_mismatch");
    const basis = basisSchema.parse({
      tenantId: a.tenantId,
      reservationId: a.reservationId,
      folioId: s.folioId,
      payerRevision: header.payerRevision,
      billDate: s.billDate,
      currency: s.currency,
      sourceVersions: s.sourceVersions,
      rows: s.lines
        .map((l) => ({
          lineId: l.localLineId,
          kind: l.kind,
          description: l.description,
          totalCents: l.totalCents,
        }))
        .sort((x, y) => x.lineId.localeCompare(y.lineId)),
    });
    return {
      basis,
      payer,
      record,
      snapshot: s,
      stateDigest: billingPayloadDigest({
        payerRevision: header.payerRevision,
        payer: header.payer,
        record: header.record,
      }),
      output: view(a, payer, basis, record),
    };
  }
  return {
    async prepare(actor: SettlementActor): Promise<PreparedChargeAttribution> {
      const state = await readState(actor);
      if (state.output.frozen || !state.snapshot || !state.stateDigest)
        fail("source_attribution_frozen");
      if (state.output.blockers.length) fail(state.output.blockers[0]);
      return structuredClone({
        snapshot: state.snapshot,
        payer: state.payer,
        payerRevision: state.basis.payerRevision,
        basisDigest: state.output.basisDigest,
        stateDigest: state.stateDigest,
        assignments: new Map(state.output.rows.map((r) => [r.lineId, r.leg!])),
      });
    },
    async assertCurrent(actor: SettlementActor, expected: PreparedChargeAttribution) {
      guard(actor);
      const raw = await rpc(actor, "hh_source_attribution_get", {});
      if (!raw || typeof raw !== "object") fail("source_attribution_changed");
      const h = raw as Record<string, unknown>;
      if (
        h.tenantId !== actor.tenantId ||
        h.reservationId !== actor.reservationId ||
        h.frozen !== false ||
        billingPayloadDigest({
          payerRevision: h.payerRevision,
          payer: h.payer,
          record: h.record,
        }) !== expected.stateDigest
      )
        fail("source_attribution_changed");
    },
    async read(actor: SettlementActor) {
      return (await readState(actor)).output;
    },
    async save(actor: SettlementActor, input: AttributionSave) {
      guard(actor, true);
      const a = { ...actor };
      const parsed = attributionSaveSchema.safeParse(input);
      if (!parsed.success) fail("source_charge_attribution_invalid");
      const body = parsed.data;
      const state = await readState(actor);
      same(actor, a);
      if (state.output.frozen) fail("source_attribution_frozen");
      if (
        state.output.basisDigest !== body.basisDigest ||
        state.output.revision !== body.expectedRevision
      )
        fail("source_attribution_changed");
      assignmentsFor(state.basis, body.assignments, state.payer.collectionMode);
      const result = saved(
        await rpc(actor, "hh_source_attribution_put", {
          p_expected_revision: body.expectedRevision,
          p_basis: state.basis,
          p_basis_digest: body.basisDigest,
          p_assignments: body.assignments,
        }),
      );
      same(actor, a);
      if (
        !result ||
        result.basisDigest !== body.basisDigest ||
        result.revision !== (BigInt(body.expectedRevision) + 1n).toString() ||
        JSON.stringify(
          [...assignmentsFor(result.basis, result.assignments, state.payer.collectionMode)].sort(),
        ) !==
          JSON.stringify(
            [...assignmentsFor(state.basis, body.assignments, state.payer.collectionMode)].sort(),
          )
      )
        fail("source_attribution_scope_mismatch");
      return view(actor, state.payer, state.basis, result);
    },
  };
}
export function liveChargeAttributionService() {
  return createChargeAttributionService({
    async rpc(name, args) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      return supabaseAdmin.rpc(name as never, args as never);
    },
    async snapshot(actor, payer) {
      const { loadLivePreparedSettlementSnapshot } =
        await import("./settlement-production-adapter.server");
      return loadLivePreparedSettlementSnapshot(actor, undefined, payer.policy.guestCustomerId);
    },
  });
}
