import type { SettlementActor } from "./settlement-context.server";
import type { EvidenceResult } from "./settlement";
import type { SourcePolicyStore } from "./source-billing-policy-store.server";
import { parseSourceBillingPolicy } from "./source-billing-policy.server";
import { sourcePolicySchema, parsePayerView, parsePolicyView } from "./source-policy-view";
export type SourcePolicyHttpDeps = {
  actor(): Promise<SettlementActor | null>;
  exists(kind: "policy" | "payer", id: string, actor: SettlementActor): Promise<boolean>;
  store: SourcePolicyStore;
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const revision = (v: unknown): v is string =>
  typeof v === "string" && /^(0|[1-9]\d{0,18})$/.test(v) && BigInt(v) <= 9223372036854775807n;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]) =>
  Object.keys(v).length === allowed.length && allowed.every((k) => Object.hasOwn(v, k));
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "cache-control": "no-store" } });
const deny = (status: number, error: string) => json({ error }, status);
function failure(r: Exclude<EvidenceResult<unknown>, { kind: "confirmed" }>) {
  const code = /^[a-z0-9_]{1,120}$/.test(r.code) ? r.code : "source_billing_unavailable";
  return deny(
    ["n3_session_expired", "n3_unauthorized"].includes(code)
      ? 401
      : code === "source_billing_policy_missing" || code === "reservation_not_found"
        ? 404
        : r.kind === "unavailable"
          ? 503
          : /forbidden|owner_required/.test(code)
            ? 403
            : 409,
    code,
  );
}
function sameOrigin(r: Request) {
  try {
    const site = r.headers.get("sec-fetch-site"),
      origin = r.headers.get("origin");
    return (
      (!site || site === "same-origin") &&
      (origin ? new URL(origin).origin === new URL(r.url).origin : site === "same-origin")
    );
  } catch {
    return false;
  }
}
export async function handleSourcePolicyHttp(
  mode: "policy_read" | "policy_save" | "payer_read" | "payer_save",
  request: Request,
  id: string,
  d: SourcePolicyHttpDeps,
): Promise<Response> {
  try {
    const write = mode.endsWith("save"),
      kind = mode.startsWith("policy") ? "policy" : "payer";
    if (request.method !== (write ? "POST" : "GET")) return deny(405, "method_not_allowed");
    if (write && !sameOrigin(request)) return deny(403, "cross_site_denied");
    if (
      write &&
      request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json"
    )
      return deny(415, "unsupported_media_type");
    const session = await d.actor();
    if (!session) return deny(401, "unauthenticated");
    if (
      !uuid(session.tenantId) ||
      !["owner", "front_desk"].includes(session.role) ||
      !session.n3Token?.trim() ||
      !session.n3UserKey?.trim()
    )
      return deny(403, "forbidden");
    if ((write || kind === "policy") && session.role !== "owner") return deny(403, "forbidden");
    if (!uuid(id)) return deny(400, "invalid_id");
    const actor = Object.freeze({ ...session, reservationId: kind === "payer" ? id : "" });
    function current() {
      for (const k of ["tenantId", "n3UserKey", "n3Token", "role"] as const)
        if (session![k] !== actor[k]) throw Error("source_policy_scope_mismatch");
    }
    current();
    if (!(await d.exists(kind, id, actor))) return deny(404, "not_found");
    current();
    let body: Record<string, unknown> = {};
    if (write) {
      const text = await request.text();
      if (new TextEncoder().encode(text).length > 8192) return deny(400, "invalid_input");
      try {
        const v: unknown = JSON.parse(text);
        if (!object(v)) return deny(400, "invalid_input");
        body = v;
      } catch {
        return deny(400, "invalid_input");
      }
    }
    current();
    if (kind === "policy") {
      let output;
      if (write) {
        if (!keys(body, ["expectedVersion", "policy"]) || !revision(body.expectedVersion))
          return deny(400, "invalid_input");
        const p = parseSourceBillingPolicy(body.policy, id);
        if (p.kind !== "confirmed" || p.value.version !== body.expectedVersion)
          return deny(400, "invalid_source_billing_policy");
        if (!sourcePolicySchema.safeParse(p.value).success)
          return deny(400, "invalid_source_billing_policy");
        const r = await d.store.update(actor, {
          sourceId: id,
          expectedVersion: body.expectedVersion,
          policy: p.value,
        });
        current();
        if (r.kind !== "confirmed") return failure(r);
        output = { policy: r.value, blockers: [] };
      } else {
        const r = await d.store.readSettings(actor, id);
        current();
        if (r.kind !== "confirmed") return failure(r);
        output = r.value;
      }
      const safe = parsePolicyView(
        { tenantId: actor.tenantId, sourceId: id, ...output },
        actor.tenantId,
        id,
      );
      return safe ? json(safe) : deny(503, "source_billing_invalid_result");
    }
    if (write) {
      if (
        !keys(body, [
          "collectionMode",
          "expectedRevision",
          "expectedSourceId",
          "expectedPolicyVersion",
          "expectedReservationUpdatedAt",
        ]) ||
        !uuid(body.expectedSourceId) ||
        !revision(body.expectedPolicyVersion) ||
        typeof body.expectedReservationUpdatedAt !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T/.test(body.expectedReservationUpdatedAt) ||
        !Number.isFinite(Date.parse(body.expectedReservationUpdatedAt)) ||
        !["guest", "source"].includes(String(body.collectionMode)) ||
        !revision(body.expectedRevision)
      )
        return deny(400, "invalid_input");
      const r = await d.store.confirm(
        actor,
        body.collectionMode as "guest" | "source",
        body.expectedRevision,
        {
          sourceId: body.expectedSourceId,
          policyVersion: body.expectedPolicyVersion,
          reservationUpdatedAt: body.expectedReservationUpdatedAt,
        },
      );
      current();
      if (r.kind !== "confirmed") return failure(r);
      const safe = parsePayerView(
        { ...r.value, frozen: false, policy: r.value.payer.policy, blockers: [] },
        actor.tenantId,
        id,
      );
      return safe ? json(safe) : deny(503, "source_billing_invalid_result");
    }
    const f = await d.store.readReservation(actor);
    current();
    if (f.kind !== "confirmed") return failure(f);
    // Validate saved scope before any current master read.
    const base = parsePayerView({ ...f.value, policy: null, blockers: [] }, actor.tenantId, id);
    if (!base) return deny(503, "source_billing_invalid_result");
    if (base.frozen) return json(base);
    const p = await d.store.readPolicy(actor, base.sourceId);
    current();
    if (p.kind !== "confirmed" && ["n3_session_expired", "n3_unauthorized"].includes(p.code))
      return failure(p);
    const safe = parsePayerView(
      {
        ...base,
        policy: p.kind === "confirmed" ? p.value : null,
        blockers: p.kind === "confirmed" ? [] : [p.code],
      },
      actor.tenantId,
      id,
    );
    return safe ? json(safe) : deny(503, "source_billing_invalid_result");
  } catch {
    return deny(503, "source_billing_unavailable");
  }
}
