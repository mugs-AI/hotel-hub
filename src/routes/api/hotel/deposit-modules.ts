import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import { DepositModulePolicyError, parseDepositModulePolicy } from "@/lib/deposit-module-policy";
import {
  readDepositModulePolicy,
  updateDepositModulePolicy,
} from "@/lib/deposit-module-policy.server";
import { deny, isSameOriginWrite } from "./reservations.$id.deposits";

function failure(error: unknown): Response {
  const code =
    error instanceof DepositModulePolicyError ? error.code : "deposit_module_policy_unavailable";
  const status =
    code === "forbidden"
      ? 403
      : code === "invalid_deposit_module_policy"
        ? 400
        : ["deposit_module_policy_conflict", "security_deposit_unavailable"].includes(code)
          ? 409
          : 503;
  return deny(status, code);
}
export async function handleDepositModulesGet(): Promise<Response> {
  const { ctx, decision } = await requirePermission("hotel:setup");
  if (!decision.ok) return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  if (ctx.role !== "owner") return deny(403, "forbidden");
  try {
    return Response.json(await readDepositModulePolicy(ctx.session.tenantId!), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}
export async function handleDepositModulesPatch({
  request,
}: {
  request: Request;
}): Promise<Response> {
  if (!isSameOriginWrite(request)) return deny(403, "cross_site_denied");
  const { ctx, decision } = await requirePermission("hotel:setup");
  if (!decision.ok) return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  if (ctx.role !== "owner") return deny(403, "forbidden");
  let body: unknown;
  // Precondition only: tenant and permission still come from the server session.
  if (
    request.headers.get("x-hotelhub-expected-identity") !==
    `${ctx.session.tenantId}:${ctx.session.n3UserKey}:${ctx.role}`
  )
    return deny(409, "deposit_module_identity_changed");
  try {
    body = await request.json();
  } catch {
    return deny(400, "invalid_json");
  }
  try {
    const policy = parseDepositModulePolicy(body);
    const result = await updateDepositModulePolicy(
      { tenantId: ctx.session.tenantId!, userKey: ctx.session.n3UserKey ?? "", role: ctx.role },
      policy,
    );
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
export const Route = createFileRoute("/api/hotel/deposit-modules")({
  server: { handlers: { GET: handleDepositModulesGet, PATCH: handleDepositModulesPatch } },
});
