import { attributionSaveSchema } from "./charge-attribution";
import {
  liveChargeAttributionService,
  type createChargeAttributionService,
} from "./charge-attribution.server";
import type { SettlementActor } from "./settlement-context.server";
export type AttributionHttpDeps = {
  actor(): Promise<SettlementActor | null>;
  service: ReturnType<typeof createChargeAttributionService>;
};
function sameOrigin(r: Request) {
  try {
    const s = r.headers.get("sec-fetch-site"),
      o = r.headers.get("origin");
    return (
      (!s || s === "same-origin") &&
      (o ? new URL(o).origin === new URL(r.url).origin : s === "same-origin")
    );
  } catch {
    return false;
  }
}
export async function handleChargeAttributionHttp(
  request: Request,
  reservationId: string,
  d: AttributionHttpDeps,
) {
  const json = (v: unknown, status = 200) =>
    Response.json(v, { status, headers: { "cache-control": "no-store" } });
  try {
    if (!["GET", "POST"].includes(request.method))
      return json({ error: "method_not_allowed" }, 405);
    const write = request.method === "POST";
    if (write && !sameOrigin(request)) return json({ error: "cross_site_denied" }, 403);
    if (
      write &&
      request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json"
    )
      return json({ error: "unsupported_media_type" }, 415);
    const session = await d.actor();
    if (!session) return json({ error: "unauthenticated" }, 401);
    if (
      !["owner", "front_desk"].includes(session.role) ||
      !session.n3Token?.trim() ||
      !session.n3UserKey?.trim() ||
      (write && session.role !== "owner")
    )
      return json({ error: "forbidden" }, 403);
    if (
      !/^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(reservationId)
    )
      return json({ error: "invalid_id" }, 400);
    const actor = Object.freeze({ ...session, reservationId });
    const current = () => {
      for (const k of ["tenantId", "role", "n3UserKey", "n3Token"] as const)
        if (session[k] !== actor[k]) throw Error("source_attribution_scope_mismatch");
    };
    let result;
    if (write) {
      const text = await request.text();
      if (new TextEncoder().encode(text).length > 1500000)
        return json({ error: "invalid_input" }, 400);
      let body;
      try {
        body = attributionSaveSchema.safeParse(JSON.parse(text));
      } catch {
        return json({ error: "invalid_input" }, 400);
      }
      if (!body.success) return json({ error: "invalid_input" }, 400);
      current();
      result = await d.service.save(actor, body.data);
    } else result = await d.service.read(actor);
    current();
    return json(result);
  } catch (e) {
    const raw = (e as Error).message,
      code = /^[a-z][a-z0-9_]{0,119}$/.test(raw) ? raw : "source_attribution_unavailable";
    return json(
      { error: code },
      /unauthenticated|session_expired|n3_unauthorized/.test(code)
        ? 401
        : /forbidden|owner_required/.test(code)
          ? 403
          : code === "reservation_not_found"
            ? 404
            : /changed|frozen|locked|invalid|payer_required|attribution_required/.test(code)
              ? 409
              : 503,
    );
  }
}
export function liveChargeAttributionHttpDeps(): AttributionHttpDeps {
  return {
    service: liveChargeAttributionService(),
    async actor() {
      const { readRequestContext } = await import("./session-context.server"),
        c = await readRequestContext();
      if (!c.authenticated || !c.role) return null;
      return {
        tenantId: c.session.tenantId!,
        reservationId: "",
        role: c.role,
        n3UserKey: c.session.n3UserKey,
        n3Token: c.session.n3Token,
      };
    },
  };
}
