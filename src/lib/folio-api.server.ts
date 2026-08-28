// HH-GOLIVE-01A — shared request plumbing for the folio / charges routes.
// Server-only. Every handler is same-origin cookie authenticated through the
// N3 session; nothing here talks to N3 and nothing here posts money.
import { logAudit, type AuditEventType } from "./audit.server";
import { requirePermission } from "./session-context.server";
import { getHotelSettingsReadOnly } from "./hotel-store.server";
import { FolioError, folioErrorStatus } from "./folio-store.server";
import { hasPermission, type Permission } from "./rbac";

export function folioDeny(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

export function folioJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw new FolioError("invalid_json", 400);
  }
  if (!isPlainObject(parsed)) throw new FolioError("invalid_body", 400);
  return parsed;
}

export type FolioActor = {
  tenantId: string;
  actorKey: string;
  role: Parameters<typeof hasPermission>[0];
  timezone: string;
  can: (permission: Permission) => boolean;
};

/**
 * Resolve the trusted actor for a folio route. Denials are audited with a
 * reason code only — never with request payloads.
 */
export async function requireFolioActor(
  permission: Permission,
): Promise<{ actor: FolioActor } | { response: Response }> {
  const { ctx, decision } = await requirePermission(permission);
  if (!decision.ok) {
    await logAudit({
      tenantId: ctx.session.tenantId ?? null,
      n3UserKey: ctx.session.n3UserKey ?? null,
      eventType: "hotel.folio.denied",
      detail: { permission, reason: decision.reason },
    });
    return {
      response: folioDeny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason),
    };
  }
  const tenantId = ctx.session.tenantId!;
  const settings = await getHotelSettingsReadOnly(tenantId);
  const role = ctx.role;
  return {
    actor: {
      tenantId,
      actorKey: ctx.session.n3UserKey,
      role,
      timezone: settings?.timezone ?? "Asia/Kuala_Lumpur",
      can: (p: Permission) => hasPermission(role, p),
    },
  };
}

/** Map a thrown error onto a sanitized response and an audit trail. */
export async function folioFailure(
  err: unknown,
  ctx: { tenantId: string | null; actorKey: string | null; eventType?: AuditEventType },
): Promise<Response> {
  if (err instanceof FolioError) {
    await logAudit({
      tenantId: ctx.tenantId,
      n3UserKey: ctx.actorKey,
      eventType: ctx.eventType ?? "hotel.folio.action_failed",
      detail: { code: err.code },
    });
    return folioDeny(err.status || folioErrorStatus(err.code), err.code);
  }
  console.error("[folio] unexpected failure", (err as Error)?.message?.slice(0, 200));
  await logAudit({
    tenantId: ctx.tenantId,
    n3UserKey: ctx.actorKey,
    eventType: ctx.eventType ?? "hotel.folio.action_failed",
    detail: { code: "folio_request_failed" },
  });
  return folioDeny(500, "folio_request_failed");
}
