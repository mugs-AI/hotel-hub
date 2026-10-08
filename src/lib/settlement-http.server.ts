import type { SettlementActor } from "./settlement-context.server";
import type { SettlementStepInput, SettlementView } from "./settlement";
import { hasPermission } from "./rbac";
export type SettlementHttpDeps = {
  actor(): Promise<SettlementActor | null>;
  exists(actor: SettlementActor): Promise<boolean>;
  services: {
    read(actor: SettlementActor): Promise<SettlementView>;
    step(actor: SettlementActor, input: SettlementStepInput): Promise<SettlementView>;
    reconcile(actor: SettlementActor, intentId: string): Promise<SettlementView>;
  };
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const rev = (v: unknown) =>
  typeof v === "string" && /^(0|[1-9]\d{0,18})$/.test(v) && BigInt(v) <= 9223372036854775807n;
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const deny = (status: number, error: string) =>
  Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
function step(body: unknown): SettlementStepInput | null {
  if (!plain(body) || !rev(body.expectedRevision)) return null;
  const action = body.action;
  const keys =
    action === "post_bill"
      ? ["action", "clientRequestId", "snapshotDigest", "expectedRevision", "intentId"]
      : action === "receive_balance"
        ? ["action", "intentId", "expectedRevision", "selectedAccountId"]
        : ["action", "intentId", "expectedRevision"];
  if (Object.keys(body).some((k) => !keys.includes(k))) return null;
  if (action === "post_bill") {
    if (
      !uuid(body.clientRequestId) ||
      typeof body.snapshotDigest !== "string" ||
      !/^[a-f0-9]{64}$/.test(body.snapshotDigest) ||
      (body.intentId !== undefined && !uuid(body.intentId))
    )
      return null;
  } else if (
    !["apply_deposits", "receive_balance", "apply_balance", "close"].includes(String(action)) ||
    !uuid(body.intentId) ||
    (body.selectedAccountId !== undefined && !uuid(body.selectedAccountId))
  )
    return null;
  return body as SettlementStepInput;
}
export async function handleSettlementHttp(
  mode: "read" | "step" | "reconcile",
  request: Request,
  id: string,
  deps: SettlementHttpDeps,
): Promise<Response> {
  try {
    const source = await deps.actor();
    if (!source) return deny(401, "unauthenticated");
    if (
      !hasPermission(source.role, mode === "read" ? "hotel:checkout:view" : "hotel:checkout:write")
    )
      return deny(403, "forbidden");
    if (!uuid(id)) return deny(400, "invalid_id");
    const actor = { ...source, reservationId: id };
    if (!(await deps.exists(actor))) return deny(404, "reservation_not_found");
    let result: SettlementView;
    if (mode === "read") result = await deps.services.read(actor);
    else {
      const text = await request.text();
      if (new TextEncoder().encode(text).length > 4096) return deny(400, "invalid_input");
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return deny(400, "invalid_input");
      }
      if (mode === "step") {
        const input = step(body);
        if (!input) return deny(400, "invalid_input");
        result = await deps.services.step(actor, input);
      } else {
        if (!plain(body) || Object.keys(body).length !== 1 || !uuid(body.intentId))
          return deny(400, "invalid_input");
        result = await deps.services.reconcile(actor, body.intentId);
      }
    }
    if (result.tenantId !== actor.tenantId || result.reservationId !== id)
      return deny(500, "settlement_scope_mismatch");
    if (result.blockers.includes("n3_session_expired")) return deny(401, "unauthenticated");
    if (result.blockers.includes("settlement_not_found")) return deny(404, "settlement_not_found");
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch {
    return deny(503, "settlement_unavailable");
  }
}
