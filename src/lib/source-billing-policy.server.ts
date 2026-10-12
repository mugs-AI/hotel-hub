import type { SettlementActor } from "./settlement-context.server";
import type { EvidenceResult } from "./settlement";
import type {
  CollectionMode,
  ReservationPayerSnapshot,
  SourceBillingPolicy,
} from "./source-billing";

/** Trusted server dependencies only; not a browser-controlled evidence interface.
 * Production adapters/persistence are deliberately not installed yet. */
export type SourcePolicyDeps = {
  readPolicy(
    actor: SettlementActor,
    sourceId: string,
  ): Promise<{
    tenantId: string;
    active: boolean;
    policy: SourceBillingPolicy;
  } | null>;
  readCustomer(
    actor: SettlementActor,
    customerId: number,
  ): Promise<
    EvidenceResult<{
      tenantId: string;
      customerId: number;
      active: boolean;
    }>
  >;
  readReservation(actor: SettlementActor): Promise<{
    tenantId: string;
    reservationId: string;
    sourceId: string;
    revision: string;
    updatedAt?: string;
    frozen: boolean;
    payer: ReservationPayerSnapshot | null;
  } | null>;
  now(): Date;
};
const uuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
const revision = (s: string) =>
  typeof s === "string" && /^(0|[1-9]\d{0,18})$/.test(s) && BigInt(s) <= 9223372036854775807n;
const masterId = (n: number) => Number.isInteger(n) && n > 0 && n <= 2147483647;
const mode = (s: unknown): s is CollectionMode => s === "guest" || s === "source";
const contradiction = (code: string) => ({ kind: "contradiction" as const, code });
const unavailable = (code: string) => ({ kind: "unavailable" as const, code });
function allowedActor(actor: SettlementActor) {
  return (
    ["owner", "front_desk"].includes(actor.role) &&
    uuid(actor.tenantId) &&
    uuid(actor.reservationId) &&
    typeof actor.n3UserKey === "string" &&
    !!actor.n3UserKey.trim()
  );
}
function validPolicy(p: SourceBillingPolicy, sourceId: string) {
  return (
    p &&
    p.sourceId === sourceId &&
    uuid(p.sourceId) &&
    revision(p.version) &&
    mode(p.defaultCollectionMode) &&
    Array.isArray(p.allowedCollectionModes) &&
    p.allowedCollectionModes.length > 0 &&
    p.allowedCollectionModes.every(mode) &&
    new Set(p.allowedCollectionModes).size === p.allowedCollectionModes.length &&
    p.allowedCollectionModes.includes(p.defaultCollectionMode) &&
    masterId(p.guestCustomerId) &&
    (p.sourceCustomerId === null || masterId(p.sourceCustomerId)) &&
    (!p.allowedCollectionModes.includes("source") ||
      (p.sourceCustomerId !== null && p.sourceCustomerId !== p.guestCustomerId)) &&
    typeof p.showRoomPrices === "boolean" &&
    typeof p.guestDocumentTitle === "string" &&
    p.guestDocumentTitle.trim().length > 0 &&
    p.guestDocumentTitle.length <= 160 &&
    typeof p.guestItemDescription === "string" &&
    p.guestItemDescription.trim().length > 0 &&
    p.guestItemDescription.length <= 600
  );
}
function copyPolicy(p: SourceBillingPolicy): SourceBillingPolicy {
  // Explicit allowlist: adapter extras/credentials must not enter a frozen DTO.
  const result: SourceBillingPolicy = {
    sourceId: p.sourceId,
    version: p.version,
    defaultCollectionMode: p.defaultCollectionMode,
    allowedCollectionModes: [...p.allowedCollectionModes],
    sourceCustomerId: p.sourceCustomerId,
    guestCustomerId: p.guestCustomerId,
    guestDocumentTitle: p.guestDocumentTitle,
    guestItemDescription: p.guestItemDescription,
    showRoomPrices: p.showRoomPrices,
  };
  Object.freeze(result.allowedCollectionModes);
  return Object.freeze(result);
}
export function parseSourceBillingPolicy(
  value: unknown,
  sourceId: string,
): EvidenceResult<SourceBillingPolicy> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !validPolicy(value as SourceBillingPolicy, sourceId)
  )
    return contradiction("invalid_source_billing_policy");
  return { kind: "confirmed", value: copyPolicy(value as SourceBillingPolicy) };
}
export async function readSourceBillingPolicy(
  actor: SettlementActor,
  sourceId: string,
  deps?: SourcePolicyDeps,
): Promise<EvidenceResult<SourceBillingPolicy>> {
  if (!allowedActor(actor)) return contradiction("forbidden");
  if (!uuid(sourceId)) return contradiction("invalid_source_id");
  if (!deps) return unavailable("source_billing_setup_required");
  try {
    const row = await deps.readPolicy(actor, sourceId);
    if (!row) return unavailable("source_billing_policy_missing");
    if (row.tenantId !== actor.tenantId || row.active !== true)
      return contradiction("source_policy_scope_mismatch");
    if (!validPolicy(row.policy, sourceId)) return contradiction("invalid_source_billing_policy");
    const p = copyPolicy(row.policy);
    const ids = [
      p.guestCustomerId,
      ...(p.allowedCollectionModes.includes("source") ? [p.sourceCustomerId!] : []),
    ];
    for (const id of ids) {
      const evidence = await deps.readCustomer(actor, id);
      if (evidence.kind !== "confirmed") return evidence;
      if (
        evidence.value.tenantId !== actor.tenantId ||
        evidence.value.customerId !== id ||
        evidence.value.active !== true
      )
        return contradiction("source_customer_evidence_mismatch");
    }
    return { kind: "confirmed", value: p };
  } catch {
    return unavailable("source_billing_evidence_unavailable");
  }
}
/** Prepare immutable server-owned facts only. This does NOT confirm/persist a
 * booking. The future fenced store must revalidate and atomically save them. */
export async function prepareReservationPayer(
  actor: SettlementActor,
  sourceId: string,
  selectedMode: CollectionMode,
  expectedRevision: string,
  deps?: SourcePolicyDeps,
): Promise<EvidenceResult<ReservationPayerSnapshot>> {
  if (!allowedActor(actor)) return contradiction("forbidden");
  if (!uuid(sourceId) || !mode(selectedMode) || !revision(expectedRevision))
    return contradiction("invalid_source_payer_input");
  if (!deps) return unavailable("source_billing_setup_required");
  try {
    const row = await deps.readReservation(actor);
    if (!row) return unavailable("reservation_not_found");
    if (
      row.tenantId !== actor.tenantId ||
      row.reservationId !== actor.reservationId ||
      row.sourceId !== sourceId
    )
      return contradiction("source_payer_scope_mismatch");
    if (row.revision !== expectedRevision) return contradiction("source_payer_revision_conflict");
    if (row.frozen) return contradiction("source_payer_frozen");
    if (row.payer && actor.role !== "owner") return contradiction("source_payer_owner_required");
    const policy = await readSourceBillingPolicy(actor, sourceId, deps);
    if (policy.kind !== "confirmed") return policy;
    if (!policy.value.allowedCollectionModes.includes(selectedMode))
      return contradiction("source_collection_mode_not_allowed");
    const at = deps.now();
    if (!Number.isFinite(at.getTime())) return unavailable("source_billing_clock_unavailable");
    return {
      kind: "confirmed",
      value: Object.freeze({
        policy: policy.value,
        collectionMode: selectedMode,
        confirmedBy: actor.n3UserKey,
        confirmedAt: at.toISOString(),
      }),
    };
  } catch {
    return unavailable("source_billing_evidence_unavailable");
  }
}
