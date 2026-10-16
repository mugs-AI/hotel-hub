import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import {
  readSecurityReport,
  writeSecurityStatement,
  updateSecurityPolicy,
  type SecurityActor,
} from "@/lib/security-cash.server";
import { securityObject, securityExact, securityUuid } from "@/lib/security-cash";
import { deny, isSameOriginWrite } from "./reservations.$id.deposits";
import { securityFailure } from "./reservations.$id.security-cash";
export async function handleSecurityOverviewGet({ request }: { request: Request }) {
  const { ctx, decision } = await requirePermission("hotel:deposits:view");
  if (!decision.ok) return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  const u = new URL(request.url);
  try {
    return Response.json(
      await readSecurityReport(
        { tenantId: ctx.session.tenantId!, userKey: ctx.session.n3UserKey, role: ctx.role! },
        u.searchParams.get("from") ?? new Date(0).toISOString(),
        u.searchParams.get("asAt") ?? new Date().toISOString(),
        u.searchParams.get("mode") === "shift",
      ),
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return securityFailure(e);
  }
}
export async function handleSecurityOverviewPost({ request }: { request: Request }) {
  if (!isSameOriginWrite(request)) return deny(403, "cross_site_denied");
  const { ctx, decision } = await requirePermission("hotel:deposits:view");
  if (!decision.ok) return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  if (
    request.headers.get("x-hotelhub-expected-identity") !==
    `${ctx.session.tenantId}:${ctx.session.n3UserKey}:${ctx.role}`
  )
    return deny(409, "security_identity_changed");
  try {
    const b = securityObject(await request.json());
    securityExact(b, ["key", "policy", "statement"]);
    const actor: SecurityActor = {
      tenantId: ctx.session.tenantId!,
      userKey: ctx.session.n3UserKey,
      role: ctx.role!,
    };
    if (b.policy !== undefined && b.statement !== undefined)
      return deny(400, "security_invalid_request");
    const data =
      b.policy !== undefined
        ? await updateSecurityPolicy(actor, b.policy)
        : securityUuid(b.key)
          ? await writeSecurityStatement(actor, b.key, b.statement)
          : null;
    if (!data) return deny(400, "security_invalid_request");
    return Response.json(data, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return securityFailure(e);
  }
}
export const Route = createFileRoute("/api/hotel/security-cash")({
  server: { handlers: { GET: handleSecurityOverviewGet, POST: handleSecurityOverviewPost } },
});
