/* eslint-disable @typescript-eslint/no-explicit-any -- staged service-only SQL rows */
import type {
  BillToChangeDTO,
  BillToReadDTO,
  BillToSaveInput,
  BillToSaveResult,
  FolioBillTo,
} from "./hotel-change-controls";
import type { ReceiptControlActor } from "./receipt-controls-evidence.server";
import { ReceiptControlError } from "./receipt-controls";
import { isUuid, getReservationById } from "./reservations-store.server";
import {
  changeAdmin,
  changeRpc,
  changeDbError,
  requireFreshChangeOwner,
} from "./hotel-change-controls-store.server";
const fields = { name: 160, company: 200, address: 600, phone: 60, email: 254 };
export function validateBillToInput(value: unknown): BillToSaveInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ReceiptControlError("invalid_body");
  const b = value as Record<string, unknown>;
  if (
    Object.keys(b).some(
      (k) => !["billTo", "original", "expectedRevision", "clientRequestId", "reason"].includes(k),
    ) ||
    typeof b.expectedRevision !== "string" ||
    !/^(0|[1-9]\d{0,18})$/.test(b.expectedRevision) ||
    typeof b.clientRequestId !== "string" ||
    !isUuid(b.clientRequestId) ||
    (b.reason !== undefined && (typeof b.reason !== "string" || b.reason.trim().length > 500))
  )
    throw new ReceiptControlError("invalid_body");
  if (!b.billTo || typeof b.billTo !== "object" || Array.isArray(b.billTo))
    throw new ReceiptControlError("invalid_bill_to");
  const raw = b.billTo as Record<string, unknown>,
    billTo = {} as FolioBillTo;
  if (Object.keys(raw).some((k) => !(k in fields)))
    throw new ReceiptControlError("invalid_bill_to");
  for (const k of Object.keys(fields) as (keyof FolioBillTo)[]) {
    if (typeof raw[k] !== "string" || raw[k].trim().length > fields[k])
      throw new ReceiptControlError("invalid_bill_to");
    billTo[k] = raw[k].trim();
  }
  if (!billTo.name && !billTo.company) throw new ReceiptControlError("bill_to_name_required");
  if (billTo.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billTo.email))
    throw new ReceiptControlError("invalid_bill_to_email");
  if (!b.original || typeof b.original !== "object" || Array.isArray(b.original))
    throw new ReceiptControlError("invalid_body");
  const original = b.original as Record<string, unknown>;
  if (
    Object.keys(original).some((k) => !(k in fields)) ||
    (Object.keys(fields) as (keyof FolioBillTo)[]).some(
      (k) => typeof original[k] !== "string" || (original[k] as string).length > fields[k],
    )
  )
    throw new ReceiptControlError("invalid_body");
  return {
    billTo,
    original: { ...(original as FolioBillTo) },
    expectedRevision: b.expectedRevision,
    clientRequestId: b.clientRequestId,
    ...(b.reason === undefined ? {} : { reason: (b.reason as string).trim() }),
  };
}
export type BillToDeps = {
  reservation: (tenant: string, id: string) => Promise<{ status: string } | null>;
  read: (actor: ReceiptControlActor, id: string) => Promise<BillToReadDTO>;
  save: (actor: ReceiptControlActor, data: Record<string, unknown>) => Promise<BillToSaveResult>;
  decide: (
    actor: ReceiptControlActor,
    data: { requestId: string; expectedVersion: number; decision: "approve" | "reject" },
  ) => Promise<BillToChangeDTO>;
};
const permitted = (actor: ReceiptControlActor) => {
  if (!["owner", "front_desk"].includes(actor.role)) throw new ReceiptControlError("forbidden");
};
export function createBillToService(deps: BillToDeps) {
  return {
    async read(actor: ReceiptControlActor, id: string) {
      permitted(actor);
      if (!isUuid(id)) throw new ReceiptControlError("invalid_id");
      if (!(await deps.reservation(actor.tenantId, id))) throw new ReceiptControlError("not_found");
      return deps.read(actor, id);
    },
    async save(actor: ReceiptControlActor, id: string, input: BillToSaveInput) {
      permitted(actor);
      if (!isUuid(id)) throw new ReceiptControlError("invalid_id");
      const valid = validateBillToInput(input);
      const res = await deps.reservation(actor.tenantId, id);
      if (!res) throw new ReceiptControlError("not_found");
      if (!["confirmed", "checked_in"].includes(res.status))
        throw new ReceiptControlError("bill_to_locked");
      const current = await deps.read(actor, id);
      if (
        current.effectiveRevision !== valid.expectedRevision ||
        (Object.keys(fields) as (keyof FolioBillTo)[]).some(
          (k) => current.billTo[k] !== valid.original[k],
        )
      )
        throw new ReceiptControlError("bill_to_changed");
      return deps.save(actor, { ...valid, reservationId: id });
    },
    async decide(
      actor: ReceiptControlActor,
      input: { requestId: string; expectedVersion: number; decision: "approve" | "reject" },
    ) {
      if (actor.role !== "owner") throw new ReceiptControlError("forbidden");
      if (
        !isUuid(input.requestId) ||
        !Number.isSafeInteger(input.expectedVersion) ||
        input.expectedVersion < 1 ||
        !["approve", "reject"].includes(input.decision)
      )
        throw new ReceiptControlError("invalid_body");
      return deps.decide(actor, input);
    },
  };
}
async function toBillToDTO(actor: ReceiptControlActor, r: any): Promise<BillToChangeDTO> {
  const [{ resolveActorLabels }, res] = await Promise.all([
    import("./tenant-store.server"),
    getReservationById(actor.tenantId, r.reservation_id),
  ]);
  const labels = await resolveActorLabels(actor.tenantId, [r.requested_by]);
  return {
    id: r.id,
    reservationId: r.reservation_id,
    bookingReference: res?.bookingReference ?? "",
    version: r.version,
    state: r.state,
    original: r.original,
    requested: r.requested,
    reason: r.reason,
    requestedByLabel: labels.get(r.requested_by) ?? null,
    requestedAt: r.requested_at,
    canApprove: actor.role === "owner" && ["pending", "needs_review"].includes(r.state),
    canReject: actor.role === "owner" && ["pending", "needs_review"].includes(r.state),
  };
}
async function mapSave(actor: ReceiptControlActor, result: any): Promise<BillToSaveResult> {
  return { ...result, pending: result.pending ? await toBillToDTO(actor, result.pending) : null };
}
function productionBillToService() {
  return createBillToService({
    reservation: getReservationById,
    async read(actor, id) {
      const sb = await changeAdmin();
      const [bill, pending] = await Promise.all([
        sb.rpc("hotelhub_bill_to_read", { p_tenant: actor.tenantId, p_res: id }),
        sb
          .from("hotel_bill_to_change_requests")
          .select("*")
          .eq("tenant_id", actor.tenantId)
          .eq("reservation_id", id)
          .in("state", ["pending", "needs_review"])
          .maybeSingle(),
      ]);
      for (const r of [bill, pending]) if (r.error) throw changeDbError(r.error);
      const rev = bill.data?.effectiveRevision;
      if (typeof rev !== "string" || !/^(0|[1-9]\d*)$/.test(rev))
        throw new ReceiptControlError("change_controls_unavailable");
      return {
        billTo: bill.data.billTo,
        effectiveRevision: rev,
        pending: pending.data ? await toBillToDTO(actor, pending.data) : null,
      };
    },
    async save(actor, data) {
      return mapSave(actor, await changeRpc(actor, "hotelhub_bill_to_change_save", data));
    },
    async decide(actor, data) {
      await requireFreshChangeOwner(actor);
      return toBillToDTO(actor, await changeRpc(actor, "hotelhub_bill_to_change_decide", data));
    },
  });
}
export const readBillTo = (actor: ReceiptControlActor, id: string) =>
  productionBillToService().read(actor, id);
export const saveBillTo = (actor: ReceiptControlActor, id: string, input: BillToSaveInput) =>
  productionBillToService().save(actor, id, input);
export const decideBillTo = (
  actor: ReceiptControlActor,
  input: { requestId: string; expectedVersion: number; decision: "approve" | "reject" },
) => productionBillToService().decide(actor, input);
export async function listBillToChanges(actor: ReceiptControlActor, offset = 0, limit = 50) {
  permitted(actor);
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new ReceiptControlError("invalid_page");
  let q = (await changeAdmin())
    .from("hotel_bill_to_change_requests")
    .select("*", { count: "exact" })
    .eq("tenant_id", actor.tenantId)
    .in("state", ["pending", "needs_review"])
    .order("requested_at", { ascending: false })
    .order("id")
    .range(offset, offset + limit - 1);
  if (actor.role !== "owner") q = q.eq("requested_by", actor.n3UserKey);
  const result = await q;
  if (result.error) throw changeDbError(result.error);
  return {
    requests: await Promise.all((result.data ?? []).map((r: any) => toBillToDTO(actor, r))),
    total: result.count,
    offset,
    limit,
  };
}
