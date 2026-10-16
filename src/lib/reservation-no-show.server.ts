import {
  NoShowError,
  NO_SHOW_CODES,
  validateNoShowInput,
  type NoShowInput,
  type NoShowActor,
  type NoShowResult,
} from "./reservation-no-show";
export type NoShowRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message?: string } | null }>;
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(v);
export function createNoShowStore(rpc: NoShowRpc) {
  return {
    async mark(actor: NoShowActor, input: NoShowInput): Promise<NoShowResult> {
      if (
        !uuid(actor.tenantId) ||
        !actor.n3UserKey ||
        !["owner", "front_desk"].includes(actor.role ?? "")
      )
        throw new NoShowError("forbidden");
      validateNoShowInput(input);
      const res = await rpc("hh_mark_reservation_no_show", {
        p_tenant_id: actor.tenantId,
        p_reservation_id: input.reservationId,
        p_actor_n3_user_key: actor.n3UserKey,
        p_expected_updated_at: input.expectedUpdatedAt,
        p_client_request_id: input.clientRequestId,
        p_reason: input.reason.trim(),
      });
      if (res.error)
        throw new NoShowError(
          NO_SHOW_CODES.has(res.error.message ?? "") ? res.error.message! : "no_show_unavailable",
        );
      const row = res.data as Partial<NoShowResult> | null;
      if (
        !row ||
        row.reservationId !== input.reservationId ||
        row.status !== "no_show" ||
        typeof row.updatedAt !== "string" ||
        !Number.isFinite(Date.parse(row.updatedAt)) ||
        !Array.isArray(row.releasedRoomIds) ||
        row.releasedRoomIds.some((v) => !uuid(v)) ||
        new Set(row.releasedRoomIds).size !== row.releasedRoomIds.length ||
        typeof row.accountingReviewRequired !== "boolean"
      )
        throw new NoShowError("no_show_unavailable");
      return {
        reservationId: row.reservationId,
        status: "no_show",
        updatedAt: row.updatedAt,
        releasedRoomIds: row.releasedRoomIds,
        accountingReviewRequired: row.accountingReviewRequired,
      };
    },
  };
}
export function liveNoShowStore() {
  return createNoShowStore(async (name, args) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return (supabaseAdmin as unknown as { rpc: NoShowRpc }).rpc(name, args);
  });
}
export async function markReservationNoShow(
  actor: NoShowActor,
  input: NoShowInput,
): Promise<NoShowResult> {
  return liveNoShowStore().mark(actor, input);
}
