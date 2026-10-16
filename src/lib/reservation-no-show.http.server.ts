import {
  noShowFailureCode,
  validateNoShowInput,
  type NoShowActor,
  type NoShowInput,
  type NoShowResult,
} from "./reservation-no-show";
export type NoShowHttpDeps = {
  actor(): Promise<NoShowActor | null>;
  read(
    actor: NoShowActor,
    id: string,
  ): Promise<{ eligible: boolean; propertyDate: string; updatedAt: string } | null>;
  mark(actor: NoShowActor, input: NoShowInput): Promise<NoShowResult>;
};
import { isSameOriginWrite, readJsonBody, deny } from "./operations-api.server";
import { isUuid } from "./reservations-store.server";
export async function handleNoShowHttp(
  mode: "read" | "mark",
  request: Request,
  id: string,
  deps: NoShowHttpDeps,
): Promise<Response> {
  try {
    if (mode === "mark" && !isSameOriginWrite(request)) return deny(403, "forbidden");
    const actor = await deps.actor();
    if (!actor) return deny(401, "unauthenticated");
    if (!["owner", "front_desk"].includes(actor.role ?? "")) return deny(403, "forbidden");
    if (!isUuid(id)) return deny(400, "invalid_id");
    if (mode === "read") {
      const state = await deps.read(actor, id);
      return state
        ? Response.json({ state }, { headers: { "cache-control": "no-store" } })
        : deny(404, "reservation_not_found");
    }
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return deny(400, parsed.code);
    if (
      Object.keys(parsed.body).some(
        (k) => !["expectedUpdatedAt", "clientRequestId", "reason"].includes(k),
      )
    )
      return deny(400, "invalid_request");
    const input = { ...parsed.body, reservationId: id } as NoShowInput;
    validateNoShowInput(input);
    return Response.json(
      { result: await deps.mark(actor, input) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const code = noShowFailureCode(error);
    return deny(
      code === "forbidden"
        ? 403
        : code === "reservation_not_found"
          ? 404
          : code === "invalid_request"
            ? 400
            : code === "no_show_unavailable"
              ? 503
              : 409,
      code,
    );
  }
}
export function liveNoShowHttpDeps(): NoShowHttpDeps {
  return {
    actor: async () => {
      const { readRequestContext } = await import("./session-context.server");
      const ctx = await readRequestContext();
      if (!ctx.authenticated || !ctx.role) return null;
      return { tenantId: ctx.session.tenantId!, n3UserKey: ctx.session.n3UserKey, role: ctx.role };
    },
    read: async (actor, id) => {
      const [{ getReservationById }, { resolvePropertyToday }, { noShowEligible }] =
        await Promise.all([
          import("./reservations-store.server"),
          import("./checkout-preview.server"),
          import("./reservation-no-show"),
        ]);
      const reservation = await getReservationById(actor.tenantId, id);
      if (!reservation) return null;
      const propertyDate = await resolvePropertyToday(actor.tenantId);
      return {
        propertyDate,
        updatedAt: reservation.updatedAt,
        eligible:
          noShowEligible(reservation.status, reservation.arrivalDate, propertyDate) &&
          reservation.checkedInAt === null &&
          reservation.rooms.every((r) => r.allocationStatus !== "occupied"),
      };
    },
    mark: async (actor, input) => {
      const { markReservationNoShow } = await import("./reservation-no-show.server");
      return markReservationNoShow(actor, input);
    },
  };
}
