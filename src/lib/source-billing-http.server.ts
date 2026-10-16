import { hasPermission } from "./rbac";
import { parseSourceCheckoutView } from "./source-billing-checkout";
import { parseSettlementStepInput } from "./settlement-http.server";
import type { SettlementActor } from "./settlement-context.server";
import type { SourceCheckoutView, SourceConfirmInput } from "./source-billing-confirmation.server";
import type { runSourceBillStep } from "./source-billing-coordinator.server";
export type SourceBillingStepInput = Parameters<typeof runSourceBillStep>[1];
export type SourceBillingHttpDeps = {
  actor(): Promise<SettlementActor | null>;
  exists(actor: SettlementActor): Promise<boolean>;
  services: {
    read(actor: SettlementActor): Promise<SourceCheckoutView>;
    confirm(actor: SettlementActor, input: SourceConfirmInput): Promise<SourceCheckoutView>;
    step(actor: SettlementActor, input: SourceBillingStepInput): Promise<SourceCheckoutView>;
    reconcile(actor: SettlementActor, planDigest: string): Promise<SourceCheckoutView>;
  };
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, names: string[]) =>
  Object.keys(v).length === names.length && names.every((k) => Object.hasOwn(v, k));
const rev = (v: unknown): v is string =>
  typeof v === "string" && /^(0|[1-9]\d{0,18})$/.test(v) && BigInt(v) <= 9223372036854775807n;
const deny = (status: number, error: string) =>
  Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
export async function handleSourceBillingHttp(
  mode: "read" | "confirm" | "step" | "reconcile",
  request: Request,
  id: string,
  deps: SourceBillingHttpDeps,
): Promise<Response> {
  try {
    if (request.method !== (mode === "read" ? "GET" : "POST"))
      return deny(405, "method_not_allowed");
    if (mode !== "read") {
      const site = request.headers.get("sec-fetch-site"),
        origin = request.headers.get("origin");
      if (
        (site && site !== "same-origin") ||
        (origin ? new URL(origin).origin !== new URL(request.url).origin : site !== "same-origin")
      )
        return deny(403, "cross_site_denied");
      if (
        request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
        "application/json"
      )
        return deny(415, "unsupported_media_type");
    }
    const session = await deps.actor();
    if (!session) return deny(401, "unauthenticated");
    if (
      !hasPermission(session.role, "hotel:checkout:write") ||
      !session.n3Token?.trim() ||
      !session.n3UserKey?.trim()
    )
      return deny(403, "forbidden");
    if (!uuid(id)) return deny(400, "invalid_id");
    const actor = { ...session, reservationId: id };
    async function current() {
      const now = await deps.actor();
      return (
        !!now &&
        ["tenantId", "n3UserKey", "n3Token", "role"].every(
          (k) => now[k as keyof SettlementActor] === actor[k as keyof SettlementActor],
        )
      );
    }
    const exists = await deps.exists(actor);
    if (!(await current())) return deny(401, "unauthenticated");
    if (!exists) return deny(404, "reservation_not_found");
    let result: SourceCheckoutView;
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
      if (!object(body)) return deny(400, "invalid_input");
      if (!(await current())) return deny(401, "unauthenticated");
      if (mode === "confirm") {
        if (
          !keys(body, ["expectedFolioRevision", "planDigest", "clientRequestId"]) ||
          !rev(body.expectedFolioRevision) ||
          !hash(body.planDigest) ||
          !uuid(body.clientRequestId)
        )
          return deny(400, "invalid_input");
        result = await deps.services.confirm(actor, body as SourceConfirmInput);
      } else if (mode === "step") {
        const action = parseSettlementStepInput(body.action);
        if (
          !keys(body, ["legId", "planDigest", "expectedRevision", "action"]) ||
          !uuid(body.legId) ||
          !hash(body.planDigest) ||
          !rev(body.expectedRevision) ||
          !action ||
          action.action === "close" ||
          action.intentId !== body.legId ||
          action.expectedRevision !== body.expectedRevision
        )
          return deny(400, "invalid_input");
        result = await deps.services.step(actor, { ...body, action } as SourceBillingStepInput);
      } else {
        if (!keys(body, ["planDigest"]) || !hash(body.planDigest))
          return deny(400, "invalid_input");
        result = await deps.services.reconcile(actor, body.planDigest);
      }
    }
    if (!(await current())) return deny(401, "unauthenticated");
    const safe = parseSourceCheckoutView(result, actor.tenantId, id);
    if (!safe) return deny(503, "source_billing_invalid_result");
    if (safe.blockers.some((c) => ["n3_session_expired", "n3_unauthorized"].includes(c)))
      return deny(401, "unauthenticated");
    return Response.json(safe, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    if (
      [
        "settlement_snapshot_changed",
        "settlement_stale_revision",
        "settlement_conflicting_request",
        "settlement_locked",
        "source_billing_payer_changed",
      ].includes(code)
    )
      return deny(409, code);
    return deny(503, "source_billing_unavailable");
  }
}
