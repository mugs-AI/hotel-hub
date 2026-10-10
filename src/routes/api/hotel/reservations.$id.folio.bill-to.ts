import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getReservationById, isUuid } from "@/lib/reservations-store.server";
import {
  folioDeny,
  folioJson,
  folioSameOriginGuard,
  requireFolioActor,
} from "@/lib/folio-api.server";
import { logAudit } from "@/lib/audit.server";

import type { FolioBillTo } from "@/lib/hotel-change-controls";
export type { FolioBillTo } from "@/lib/hotel-change-controls";
import { readChangePolicy } from "@/lib/hotel-change-controls-store.server";
import { ReceiptControlError } from "@/lib/receipt-controls";
import { readBillTo, saveBillTo } from "@/lib/folio-bill-to-controls.server";
import type { BillToSaveInput } from "@/lib/hotel-change-controls";
const controlledActor = (actor: import("@/lib/folio-api.server").FolioActor) => ({
  tenantId: actor.tenantId,
  n3UserKey: actor.actorKey,
  n3Token: actor.n3Token,
  role: actor.role!,
});
function controlledFailure(err: unknown): Response | null {
  if (!(err instanceof ReceiptControlError)) return null;
  const status = [
    "bill_to_changed",
    "bill_to_locked",
    "version_required",
    "version_conflict",
    "receipt_control_active_exists",
  ].includes(err.code)
    ? 409
    : err.code === "forbidden"
      ? 403
      : err.code === "not_found"
        ? 404
        : err.code.includes("unavailable")
          ? 503
          : 400;
  return folioDeny(status, err.code);
}

function guestAddress(
  g: NonNullable<Awaited<ReturnType<typeof getReservationById>>>["guests"][number],
): string {
  return [
    g.addressLine1,
    g.addressLine2,
    g.addressLine3,
    [g.postcode, g.city].filter(Boolean).join(" "),
    g.stateProvince || g.stateCode,
    g.countryCode,
  ]
    .filter(Boolean)
    .join("\n");
}

async function context(permission: "hotel:folio:view" | "hotel:reservations:edit", id: string) {
  const gate = await requireFolioActor(permission);
  if ("response" in gate) return { response: gate.response };
  if (!isUuid(id)) return { response: folioDeny(400, "invalid_id") };
  const reservation = await getReservationById(gate.actor.tenantId, id);
  if (!reservation) return { response: folioDeny(404, "not_found") };
  return { actor: gate.actor, reservation };
}

export async function handleReadBillTo({ params }: { params: { id?: string } }): Promise<Response> {
  try {
    const result = await context("hotel:folio:view", params.id ?? "");
    if ("response" in result) return result.response!;
    const { actor, reservation } = result;
    if (await readChangePolicy(actor.tenantId))
      return folioJson({
        ...(await readBillTo(controlledActor(actor), reservation.id)),
        controlsInstalled: true,
      });
    const g = reservation.guests.find((guest) => guest.isPrimary) ?? reservation.guests[0];
    const fallback: FolioBillTo = {
      name: g?.fullName ?? "",
      company: "",
      address: g ? guestAddress(g) : "",
      phone: g?.mobile ?? "",
      email: g?.email ?? "",
    };
    const { data, error } = await supabaseAdmin
      .from("hotel_folio_bill_to")
      .select("name, company, address, phone, email")
      .eq("tenant_id", actor.tenantId)
      .eq("reservation_id", reservation.id)
      .maybeSingle();
    if (error) throw error;
    return folioJson({ billTo: data ?? fallback, controlsInstalled: false });
  } catch (err) {
    const failure = controlledFailure(err);
    if (failure) return failure;
    console.error("[folio.bill_to.read] failed", (err as Error).message?.slice(0, 120));
    return folioDeny(500, "bill_to_read_failed");
  }
}

export async function handleSaveBillTo({
  request,
  params,
}: {
  request: Request;
  params: { id?: string };
}): Promise<Response> {
  const origin = folioSameOriginGuard(request);
  if (origin) return origin;
  try {
    const result = await context("hotel:reservations:edit", params.id ?? "");
    if ("response" in result) return result.response!;
    const { actor, reservation } = result;
    if (reservation.status !== "confirmed" && reservation.status !== "checked_in")
      return folioDeny(409, "bill_to_locked");
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body))
      return folioDeny(400, "invalid_body");
    const raw = body as Record<string, unknown>;
    if (await readChangePolicy(actor.tenantId)) {
      if (!("billTo" in raw)) return folioDeny(409, "version_required");
      return folioJson(
        await saveBillTo(controlledActor(actor), reservation.id, raw as BillToSaveInput),
      );
    }
    const limits: Record<keyof FolioBillTo, number> = {
      name: 160,
      company: 200,
      address: 600,
      phone: 60,
      email: 254,
    };
    const billTo = {} as FolioBillTo;
    for (const key of Object.keys(limits) as (keyof FolioBillTo)[]) {
      if (typeof raw[key] !== "string" || raw[key].trim().length > limits[key])
        return folioDeny(400, "invalid_bill_to");
      billTo[key] = raw[key].trim();
    }
    if (!billTo.name && !billTo.company) return folioDeny(400, "bill_to_name_required");
    if (billTo.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billTo.email))
      return folioDeny(400, "invalid_bill_to_email");
    const { error } = await supabaseAdmin.from("hotel_folio_bill_to").upsert(
      {
        tenant_id: actor.tenantId,
        reservation_id: reservation.id,
        ...billTo,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,reservation_id" },
    );
    if (error) throw error;
    await logAudit({
      tenantId: actor.tenantId,
      n3UserKey: actor.actorKey,
      eventType: "hotel.folio.bill_to_updated",
      detail: { reservationId: reservation.id },
    });
    return folioJson({ billTo });
  } catch (err) {
    const failure = controlledFailure(err);
    if (failure) return failure;
    console.error("[folio.bill_to.save] failed", (err as Error).message?.slice(0, 120));
    return folioDeny(500, "bill_to_save_failed");
  }
}

export const Route = createFileRoute("/api/hotel/reservations/$id/folio/bill-to")({
  server: { handlers: { GET: handleReadBillTo, PUT: handleSaveBillTo } },
});
