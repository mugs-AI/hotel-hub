import { housekeepingAuthority } from "@/lib/housekeeping";
import { createFileRoute } from "@tanstack/react-router";
import { getHotelSettingsReadOnly } from "@/lib/hotel-store.server";
import { requirePermission } from "@/lib/session-context.server";
import {
  SecurityCashError,
  securityExact,
  securityObject,
  securityUuid,
} from "@/lib/security-cash";
import {
  readSecurityInspection,
  readSecurityCash,
  writeSecurityCash,
  type SecurityActor,
} from "@/lib/security-cash.server";
import { deny, isSameOriginWrite } from "./reservations.$id.deposits";
export const securityFailure = (e: unknown) => {
  const code = e instanceof SecurityCashError ? e.code : "security_unavailable";
  return deny(
    code === "forbidden"
      ? 403
      : code === "reservation_not_found"
        ? 404
        : code === "security_unavailable"
          ? 503
          : code.includes("invalid") || code === "security_cash_only"
            ? 400
            : 409,
    code,
  );
};
export async function handleSecurityReservationGet({
  params,
  request,
}: {
  params: { id: string };
  request?: Request;
}) {
  const inspection = request
    ? new URL(request.url).searchParams.get("mode") === "inspection"
    : false;
  const { ctx, decision } = await requirePermission(
    inspection ? "hotel:housekeeping:view" : "hotel:deposits:view",
  );
  if (!decision.ok) return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  try {
    if (inspection) {
      const settings = await getHotelSettingsReadOnly(ctx.session.tenantId!);
      if (!housekeepingAuthority(settings?.housekeepingMode ?? "simple", ctx.role).canViewBoard)
        return deny(403, "forbidden");
      return Response.json(
        await readSecurityInspection(
          { tenantId: ctx.session.tenantId!, userKey: ctx.session.n3UserKey, role: ctx.role! },
          params.id,
        ),
        { headers: { "cache-control": "no-store" } },
      );
    }
    const cash = await readSecurityCash(
      { tenantId: ctx.session.tenantId!, userKey: ctx.session.n3UserKey, role: ctx.role! },
      params.id,
    );
    const settings = await getHotelSettingsReadOnly(ctx.session.tenantId!).catch(() => null);
    cash.property = {
      name: ctx.session.companyName || "Hotel",
      address: settings?.folioContactAddress || "",
      phone: settings?.folioContactPhone || "",
      email: settings?.folioContactEmail || "",
    };
    return Response.json(cash, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return securityFailure(e);
  }
}
export async function handleSecurityReservationPost({
  request,
  params,
}: {
  request: Request;
  params: { id: string };
}) {
  if (!isSameOriginWrite(request)) return deny(403, "cross_site_denied");
  // Inspection can be supplied by housekeeping without exposing any cash reader.
  const { ctx, decision } = await requirePermission("app:view");
  if (!decision.ok) return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  if (
    request.headers.get("x-hotelhub-expected-identity") !==
    `${ctx.session.tenantId}:${ctx.session.n3UserKey}:${ctx.role}`
  )
    return deny(409, "security_identity_changed");
  try {
    if (ctx.role === "housekeeper") {
      const settings = await getHotelSettingsReadOnly(ctx.session.tenantId!);
      if (!housekeepingAuthority(settings?.housekeepingMode ?? "simple", ctx.role).canViewBoard)
        return deny(403, "forbidden");
    }
    const b = securityObject(await request.json());
    securityExact(b, ["key", "command"]);
    if (!securityUuid(b.key)) return deny(400, "security_invalid_request");
    const actor: SecurityActor = {
      tenantId: ctx.session.tenantId!,
      userKey: ctx.session.n3UserKey,
      role: ctx.role!,
    };
    return Response.json(await writeSecurityCash(actor, params.id, b.key, b.command), {
      headers: { "cache-control": "no-store" },
    });
  } catch (e) {
    return securityFailure(e);
  }
}
export const Route = createFileRoute("/api/hotel/reservations/$id/security-cash")({
  server: { handlers: { GET: handleSecurityReservationGet, POST: handleSecurityReservationPost } },
});
